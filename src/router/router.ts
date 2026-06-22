import type {
  IView,
  IRouter,
  ViewContext,
  ErrorHandler,
  ActionErrorTarget,
  ActionMeta,
  LayoutConstructor,
  GuardConstructor,
  ResolvedRoute,
  DisposeReason,
} from '../types/index.js';
import type { ILogger, ILoggerFactory } from '../logging/types.js';
import type { CompiledPattern, RouteMatch } from './matcher.js';
import { resolveViewPath, DEFAULT_VIEWS_ROOT } from '../core/view-resolution.js';
import {
  compileRoutePattern,
  matchRoute,
  computeRouteSpecificity,
  compileCatchAll,
} from './matcher.js';
import {
  getControllerMeta,
  getAllActionMeta,
  getRetentionMeta,
  getClassGuards,
  getMethodGuards,
  getBodyMeta,
} from '../core/decorators.js';
import type { BodyMeta } from '../core/decorators.js';
import { bindFormData } from '../validation/binder.js';
import { resolveLayoutChain } from '../layout/layout.js';
import type { LayoutMap } from '../layout/layout.js';
import { Container } from '../di/container.js';
import { getInjectTokens } from '../di/decorators.js';
import { Controller } from '../core/controller.js';
import { assembleContext } from '../core/context.js';
import type { PartialRenderer } from '../core/context.js';
import type { ComponentFunction } from '../types/index.js';
import { buildNonRouteMethodContext } from '../core/non-route-methods.js';

type AnyConstructor = new (...args: unknown[]) => unknown;
type ControllerLoader = () => Promise<{ readonly default: AnyConstructor }>;

/**
 * Callback invoked by the router when a view/partial IView result needs to be
 * rendered and mounted into the outlet. Provided by the bootstrap layer.
 * `resolvedPath` is the full file path of the view, already resolved from
 * convention or explicit override by the router before this is called.
 * `layoutChain` is the ordered layout constructors to wrap the view in,
 * innermost first; the bootstrap renderer applies them before mounting.
 */
export type ViewRenderer = (
  iview: IView,
  context: ViewContext,
  outlet: Element,
  resolvedPath: string,
  layoutChain: LayoutConstructor[],
) => Promise<void>;

/**
 * Inspection record passed to {@link RouterOptions.onDispatch} after a guard
 * denies navigation or an action completes. Used by testing and devtools to
 * observe routing outcomes without scraping private state.
 */
export interface RouterDispatchInfo {
  readonly controllerClass: AnyConstructor | null;
  readonly controller: Controller | null;
  readonly action: string | null;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** The action's IView result, or null when navigation was cancelled. */
  readonly result: IView | null;
  /** True when a guard denied the navigation (the action did not run). */
  readonly cancelled: boolean;
}

export interface RouterOptions {
  readonly viewRenderer?: ViewRenderer;
  readonly appErrorHandler?: ErrorHandler;
  readonly viewsRoot?: string;
  readonly loggerFactory?: ILoggerFactory;
  readonly makePartialRenderer?: (router: IRouter, params: Readonly<Record<string, string>>, query: URLSearchParams) => PartialRenderer;
  readonly componentMap?: Readonly<Record<string, ComponentFunction>>;
  readonly layoutMap?: LayoutMap;
  readonly onNotFound?: (pathname: string) => void;
  readonly onDispatch?: (info: RouterDispatchInfo) => void;
}

interface RouteEntry {
  readonly controllerClass: AnyConstructor;
  readonly methodName: string;
  readonly compiledPattern: CompiledPattern;
  readonly verb: ActionMeta['verb'];
  readonly specificity: number;
  readonly isCatchAll: boolean;
}

interface MatchedRoute {
  readonly entry: RouteEntry;
  readonly routeMatch: RouteMatch;
}

interface ActionArgs {
  readonly args: unknown[];
  readonly fieldErrors: Readonly<Record<string, string>>;
}

function buildActionArgs(
  compiled: CompiledPattern,
  params: Readonly<Record<string, string>>,
  formData: FormData | null,
  verb: ActionMeta['verb'],
  bodyMeta: BodyMeta | undefined,
): ActionArgs {
  const args: unknown[] = compiled.paramNames.map((name): string | undefined => {
    return (params as Record<string, string | undefined>)[name];
  });

  const isBodyVerb = verb === 'POST' || verb === 'PUT' || verb === 'PATCH';
  if (isBodyVerb && formData !== null) {
    if (bodyMeta !== undefined) {
      // @body present: bind and validate the form data into the typed DTO and
      // place the instance at the decorated parameter position.
      const { instance, fieldErrors } = bindFormData(bodyMeta.dto, formData);
      while (args.length <= bodyMeta.index) args.push(undefined);
      args[bodyMeta.index] = instance;
      return { args, fieldErrors };
    }
    // No @body: pass the raw FormData as the last argument (file uploads,
    // multi-value keys, dynamic fields, passthrough).
    args.push(formData);
  }

  return { args, fieldErrors: {} };
}

interface RetentionCacheEntry {
  readonly instance: Controller;
  readonly ttlMs: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class Router implements IRouter {
  readonly #container: Container;
  readonly #outlet: Element;
  readonly #viewRenderer: ViewRenderer | undefined;
  readonly #appErrorHandler: ErrorHandler | undefined;
  readonly #viewsRoot: string;
  readonly #routeTable: RouteEntry[] = [];
  readonly #retentionCache = new Map<AnyConstructor, RetentionCacheEntry>();
  readonly #log: ILogger | undefined;
  readonly #pendingLoaders: ControllerLoader[] = [];
  readonly #makePartialRenderer: RouterOptions['makePartialRenderer'];
  readonly #componentMap: Readonly<Record<string, ComponentFunction>> | undefined;
  readonly #layoutMap: LayoutMap | undefined;
  readonly #onNotFound: ((pathname: string) => void) | undefined;
  readonly #onDispatch: ((info: RouterDispatchInfo) => void) | undefined;
  #activeController: Controller | null = null;
  #activeControllerClass: AnyConstructor | null = null;
  #activeRoute: ResolvedRoute | null = null;

  constructor(container: Container, outlet: Element, options?: RouterOptions) {
    this.#container = container;
    this.#outlet = outlet;
    this.#viewRenderer = options?.viewRenderer;
    this.#appErrorHandler = options?.appErrorHandler;
    this.#viewsRoot = options?.viewsRoot ?? DEFAULT_VIEWS_ROOT;
    this.#log = options?.loggerFactory?.create('TypeMVC.Router');
    this.#makePartialRenderer = options?.makePartialRenderer;
    this.#componentMap = options?.componentMap;
    this.#layoutMap = options?.layoutMap;
    this.#onNotFound = options?.onNotFound;
    this.#onDispatch = options?.onDispatch;
  }

  registerController(cls: AnyConstructor): void {
    const meta = getControllerMeta(cls);
    if (meta === undefined) return;

    const proto = cls.prototype as object;
    const actionMetas = getAllActionMeta(proto);
    if (actionMetas.size === 0) return;

    const isCatchAll = meta.basePath === '*';

    for (const [methodName, actionMeta] of actionMetas) {
      const compiledPattern = isCatchAll
        ? compileCatchAll()
        : compileRoutePattern(meta.basePath, actionMeta.segment);

      const specificity = computeRouteSpecificity(meta.basePath, actionMeta.segment);

      if (__DEV__) {
        this.#log?.debug('Route registered', {
          controller: cls.name,
          basePath: meta.basePath,
          action: methodName,
          verb: actionMeta.verb,
          segment: actionMeta.segment,
        });
      }

      this.#routeTable.push({
        controllerClass: cls,
        methodName,
        compiledPattern,
        verb: actionMeta.verb,
        specificity,
        isCatchAll,
      });
    }

    this.#routeTable.sort((a, b) => b.specificity - a.specificity);
  }

  registerLoader(loader: ControllerLoader): void {
    this.#pendingLoaders.push(loader);
  }

  async #resolvePendingLoaders(): Promise<void> {
    if (this.#pendingLoaders.length === 0) return;
    const loaders = this.#pendingLoaders.splice(0);
    const modules = await Promise.all(loaders.map((l) => l()));
    for (const mod of modules) {
      this.registerController(mod.default);
    }
  }

  async #runGuards(
    entry: RouteEntry,
    params: Readonly<Record<string, string>>,
    pathname: string,
    query: URLSearchParams,
  ): Promise<boolean> {
    const classGuards = getClassGuards(entry.controllerClass);
    const proto = entry.controllerClass.prototype as object;
    const methodGuards = getMethodGuards(proto, entry.methodName);
    const allGuards = [...classGuards, ...methodGuards];
    if (allGuards.length === 0) return true;

    const route: ResolvedRoute = { pathname, params, query };
    for (const guardCtor of allGuards) {
      const guard = this.#instantiateGuard(guardCtor);
      let permitted: boolean;
      try {
        permitted = Boolean(await Promise.resolve(guard.canActivate(route)));
      } catch {
        permitted = false;
      }
      if (!permitted) return false;
    }
    return true;
  }

  #instantiateGuard(guardCtor: GuardConstructor): { canActivate: (...args: unknown[]) => unknown } {
    const tokens = getInjectTokens(guardCtor);
    const deps: unknown[] = tokens.map((token, i) => {
      if (token === undefined) {
        throw new Error(
          `[TypeMVC] Guard "${guardCtor.name}" constructor parameter at index ${String(i)} ` +
            `has no @inject decorator. All injected parameters must be decorated with @inject.`,
        );
      }
      return this.#container.resolve(token);
    });
    return new guardCtor(...deps);
  }

  /** Registers the Navigation API listener. Call once during bootstrap. */
  attach(): void {
    navigation.addEventListener('navigate', (event: NavigateEvent) => {
      if (!event.canIntercept || event.hashChange || event.downloadRequest !== null) return;

      event.intercept({
        handler: async (): Promise<void> => {
          const formData = event.formData;
          await this.#handle(event.destination.url, formData);
        },
      });
    });
  }

  /** Dispatches the current URL through the route table. Used for initial load. */
  async handleCurrentUrl(): Promise<void> {
    await this.#handle(location.href, null);
  }

  /** Exposed for testing: directly dispatch a URL without a NavigateEvent. */
  async handle(url: string, formData: FormData | null): Promise<void> {
    return this.#handle(url, formData);
  }

  async #handle(url: string, formData: FormData | null): Promise<void> {
    await this.#resolvePendingLoaders();

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    const pathname = parsed.pathname;
    const verb: ActionMeta['verb'] = formData !== null ? 'POST' : 'GET';

    if (__DEV__) {
      this.#log?.debug('Navigation intercepted', { method: verb, url: pathname });
    }

    const matched = this.#findMatch(pathname, verb);
    if (matched === null) {
      this.#log?.warn('No route matched', { method: verb, url: pathname });
      this.#onNotFound?.(pathname);
      return;
    }

    if (__DEV__) {
      this.#log?.debug('Route matched', {
        pattern: matched.entry.compiledPattern.regexp.source,
        params: matched.routeMatch.params,
      });
    }

    const { entry, routeMatch } = matched;
    const params = routeMatch.params;
    const query = new URLSearchParams(parsed.search);

    const permitted = await this.#runGuards(entry, params, pathname, query);
    if (!permitted) {
      this.#onDispatch?.({
        controllerClass: entry.controllerClass,
        controller: null,
        action: entry.methodName,
        params,
        query,
        result: null,
        cancelled: true,
      });
      return;
    }

    const nextRoute: ResolvedRoute = { pathname, params, query };

    await this.#deactivateCurrent();

    const controllerInstance = this.#resolveController(entry.controllerClass);

    const lifecycleError = (err: Error, hookName: string): void => {
      this.#appErrorHandler?.(err, hookName);
    };

    await controllerInstance._runInit(lifecycleError);

    this.#activeController = controllerInstance;
    this.#activeControllerClass = entry.controllerClass;
    this.#activeRoute = nextRoute;

    await controllerInstance._activate(nextRoute, lifecycleError);

    const proto = entry.controllerClass.prototype as Record<string, unknown>;
    const bodyMeta = getBodyMeta(proto, entry.methodName);
    const { args, fieldErrors } = buildActionArgs(
      entry.compiledPattern,
      params,
      formData,
      entry.verb,
      bodyMeta,
    );
    // Surface binding/validation failures on context.errors before the action
    // runs, so the action can inspect this.hasErrors() (SRS 7.5).
    if (Object.keys(fieldErrors).length > 0) {
      controllerInstance._primeErrors(fieldErrors);
    }

    const actionFn = proto[entry.methodName];
    if (typeof actionFn !== 'function') return;

    const bound = (actionFn as (...a: unknown[]) => unknown).bind(controllerInstance);

    let iview: IView;
    try {
      iview = (await Promise.resolve(bound(...args))) as IView;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.#appErrorHandler !== undefined) {
        this.#appErrorHandler(error, entry.methodName);
      }
      return;
    }

    this.#onDispatch?.({
      controllerClass: entry.controllerClass,
      controller: controllerInstance,
      action: entry.methodName,
      params,
      query,
      result: iview,
      cancelled: false,
    });

    await this.#handleView(iview, entry, controllerInstance, params, query);
    this.#log?.info('Navigation complete', { url: pathname });
  }

  async #deactivateCurrent(): Promise<void> {
    if (this.#activeController === null || this.#activeControllerClass === null || this.#activeRoute === null) return;

    const instance = this.#activeController;
    const cls = this.#activeControllerClass;
    const route = this.#activeRoute;

    this.#activeController = null;
    this.#activeControllerClass = null;
    this.#activeRoute = null;

    const lifecycleError = (err: Error, hookName: string): void => {
      this.#appErrorHandler?.(err, hookName);
    };

    await instance._deactivate(route, lifecycleError);

    const meta = getRetentionMeta(cls);
    if (meta !== undefined) {
      const existing = this.#retentionCache.get(cls);
      if (existing?.timer !== undefined) {
        clearTimeout(existing.timer);
      }
      const entry: RetentionCacheEntry = {
        instance,
        ttlMs: meta.ttlMs,
        timer: meta.ttlMs !== undefined
          ? setTimeout((): void => { void this.#evict(cls, 'ttl-expired'); }, meta.ttlMs)
          : undefined,
      };
      this.#retentionCache.set(cls, entry);
    } else {
      await instance._dispose('navigation', lifecycleError);
    }
  }

  async #evict(cls: AnyConstructor, reason: DisposeReason): Promise<void> {
    const entry = this.#retentionCache.get(cls);
    if (entry === undefined) return;
    this.#retentionCache.delete(cls);
    const lifecycleError = (err: Error, hookName: string): void => {
      this.#appErrorHandler?.(err, hookName);
    };
    await entry.instance._dispose(reason, lifecycleError);
  }

  async #handleView(
    iview: IView,
    entry: RouteEntry,
    controllerInstance: Controller,
    params: Readonly<Record<string, string>>,
    query: URLSearchParams,
  ): Promise<void> {
    switch (iview.kind) {
      case 'redirect':
        navigation.navigate(iview.path);
        return;
      case 'redirect-replace':
        navigation.navigate(iview.path, { history: 'replace' });
        return;
      case 'empty':
        return;
      case 'view':
      case 'partial': {
        if (this.#viewRenderer === undefined) return;

        const resolvedPath = resolveViewPath(
          iview.path,
          entry.controllerClass.name,
          entry.methodName,
          this.#viewsRoot,
        );

        if (__DEV__) {
          this.#log?.debug('View resolved', { resolvedPath });
        }

        const errorsTarget: ActionErrorTarget = { action: null };
        const nonRouteMethods = buildNonRouteMethodContext(
          entry.controllerClass,
          controllerInstance,
          errorsTarget,
          this.#appErrorHandler,
        );
        const renderPartial = this.#makePartialRenderer?.(this, params, query);
        const viewModel = iview.model;
        const viewBag = controllerInstance._getViewBag();
        const context = assembleContext(
          viewModel,
          viewBag,
          errorsTarget,
          this,
          params,
          query,
          nonRouteMethods,
          undefined,
          renderPartial,
          this.#componentMap,
        );

        const layoutChain = resolveLayoutChain(entry.controllerClass, entry.methodName, this.#layoutMap);
        await this.#mountView(iview, context, resolvedPath, layoutChain);
        return;
      }
    }
  }

  async #mountView(
    iview: IView,
    context: ViewContext,
    resolvedPath: string,
    layoutChain: LayoutConstructor[],
  ): Promise<void> {
    const render = this.#viewRenderer;
    if (render === undefined) return;

    // Cast to Record<string, unknown> so the startViewTransition check is valid:
    // Document in older browsers lacks startViewTransition, making this a genuine runtime check.
    const doc = document as unknown as Record<string, unknown>;
    if (typeof doc.startViewTransition === 'function') {
      (doc.startViewTransition as (cb: () => void | Promise<void>) => void)(() => {
        void render(iview, context, this.#outlet, resolvedPath, layoutChain).catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.#log?.error(`View load failed: ${resolvedPath}`, error);
        });
      });
    } else {
      try {
        await render(iview, context, this.#outlet, resolvedPath, layoutChain);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#log?.error(`View load failed: ${resolvedPath}`, error);
        throw error;
      }
    }
  }

  #findMatch(pathname: string, verb: ActionMeta['verb']): MatchedRoute | null {
    for (const entry of this.#routeTable) {
      if (!entry.isCatchAll && entry.verb !== verb) continue;
      const routeMatch = matchRoute(entry.compiledPattern, pathname);
      if (routeMatch !== null) {
        return { entry, routeMatch };
      }
    }
    return null;
  }

  #resolveController(cls: AnyConstructor): Controller {
    const cached = this.#retentionCache.get(cls);
    if (cached !== undefined) {
      if (cached.timer !== undefined) {
        clearTimeout(cached.timer);
      }
      this.#retentionCache.delete(cls);
      if (__DEV__) {
        this.#log?.debug('Controller reactivated from retention cache', { controller: cls.name });
      }
      return cached.instance;
    }
    return this.#instantiate(cls);
  }

  #instantiate(cls: AnyConstructor): Controller {
    const tokens = getInjectTokens(cls);
    const deps: unknown[] = tokens.map((token, i) => {
      if (token === undefined) {
        throw new Error(
          `[TypeMVC] Controller "${cls.name}" constructor parameter at index ${String(i)} ` +
            `has no @inject decorator. All injected parameters must be decorated with @inject.`,
        );
      }
      return this.#container.resolve(token);
    });
    return new cls(...deps) as Controller;
  }

  navigateTo(path: string): void {
    navigation.navigate(path);
  }

  replace(path: string): void {
    navigation.navigate(path, { history: 'replace' });
  }

  back(): void {
    navigation.back();
  }

  forward(): void {
    navigation.forward();
  }

  get current(): string {
    return location.pathname;
  }
}

export function createRouter(
  container: Container,
  outlet: Element,
  options?: RouterOptions,
): Router {
  return new Router(container, outlet, options);
}
