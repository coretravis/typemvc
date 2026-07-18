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
  TransitionMode,
  FailureModel,
  ErrorPhase,
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
  getClassTitle,
  getMethodTitle,
  getClassPending,
  getMethodPending,
  getClassFailure,
  getMethodFailure,
} from '../core/decorators.js';
import type { BodyMeta } from '../core/decorators.js';
import { bindFormData } from '../validation/binder.js';
import { resolveLayoutChain } from '../layout/layout.js';
import type { LayoutMap } from '../layout/layout.js';
import { Container } from '../di/container.js';
import { resolveInjectedArgs } from '../di/injector.js';
import { Controller, _invokeOnActionError } from '../core/controller.js';
import { matchesMedia } from '../behaviors/media-query.js';
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
  signal?: AbortSignal,
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
  /**
   * The page title this navigation resolved, already wrapped by the application
   * template, or null when the route resolved none. It is null for a result that
   * renders no view, since the page the user is looking at has not changed.
   */
  readonly title: string | null;
}

/**
 * Called when an action throws, after the error has been logged and passed to the
 * application error handler. The router owns no DOM, so the outlet takeover lives
 * with whoever supplies this: the bootstrap layer defaults it to disposing the
 * mounted fragment and clearing the outlet, the same shape as
 * {@link RouterOptions.onNotFound}.
 */
export type ActionErrorReporter = (
  controllerName: string,
  methodName: string,
  error: Error,
) => void;

/**
 * Reported once per navigation that mounted a view into the outlet, after the DOM
 * holds it. A redirect or an empty result mounts nothing and reports nothing.
 *
 * The router owns no DOM beyond the outlet, so what to do with this lives with
 * whoever supplies {@link RouterOptions.onMounted}: the bootstrap layer names the
 * route in a live region so a screen reader announces the new page.
 */
export interface MountedRoute {
  readonly pathname: string;
  /**
   * True when this was the document's first navigation, the one dispatched from
   * the URL the document loaded with. A browser announces a fresh document load
   * by itself, so an announcer must not announce it a second time.
   */
  readonly initialLoad: boolean;
  /**
   * The page title this navigation resolved, or null when the route resolved none.
   * An announcer says this, and falls back to the pathname, which is worse than a
   * title and much better than silence.
   */
  readonly title: string | null;
}

/**
 * Reported when an action throws, after the controller hook, the application error
 * handler and the logger have run. Used by testing to observe the failure path
 * without a DOM. `view` is the failure IView that claimed the outlet, or null when
 * none resolved and {@link RouterOptions.onActionError} took it over instead.
 */
export interface FailureInfo {
  readonly controllerClass: AnyConstructor;
  readonly controller: Controller;
  readonly action: string;
  readonly error: Error;
  readonly view: IView | null;
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
  readonly onActionError?: ActionErrorReporter;
  readonly onDispatch?: (info: RouterDispatchInfo) => void;
  readonly onMounted?: (info: MountedRoute) => void;
  /** Observes a pending view being shown while an async action awaits. */
  readonly onPending?: (view: IView) => void;
  /** Observes an action failure and which failure view, if any, claimed the outlet. */
  readonly onFailure?: (info: FailureInfo) => void;
  /**
   * Clears the outlet when a navigation that showed a pending view resolves to a
   * result that mounts nothing (a redirect or an empty view), so a skeleton is not
   * left on screen. Supplied by the bootstrap layer, which owns the outlet.
   */
  readonly clearOutlet?: () => void;
  /** Defaults to 'auto': a view transition unless the user asked for reduced motion. */
  readonly transitions?: TransitionMode;
  /** The application default pending view path, used by a route that declares no `@pending`. */
  readonly pendingView?: string;
  /** The application default failure view path, used by a route that declares no `@failure`. */
  readonly failureView?: string;
  /** How long an async action may run before its pending view is shown, in ms. Defaults to 120. */
  readonly pendingDelay?: number;
  /** The application default title (a string) or the template that wraps a route's own (a function). */
  readonly title?: string | ((page: string) => string);
}

/** The part of a ViewTransition the router uses. */
interface ViewTransitionHandle {
  /**
   * Settles when the DOM holds the new view. This is not `finished`, which waits
   * for the cross fade to play out.
   */
  readonly updateCallbackDone: Promise<void>;
}

/** How the navigation that is being dispatched came about. */
type NavigationKind = 'push' | 'replace' | 'traverse' | 'reload';

interface DispatchOptions {
  /** The document's first navigation, dispatched from the URL the document loaded with. */
  readonly initialLoad?: boolean;
  readonly navigationType?: NavigationKind;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * How long an async action may run before its pending view is shown. Short enough
 * that a slow route paints a skeleton promptly, long enough that a fast route
 * settles first and never flashes one.
 */
const DEFAULT_PENDING_DELAY = 120;

/** The set of discriminants a valid IView result carries. */
const IVIEW_KINDS: ReadonlySet<string> = new Set([
  'view',
  'partial',
  'redirect',
  'redirect-replace',
  'empty',
]);

/**
 * True when a value is a well-formed IView result. An action must return one of the
 * view constructors; anything else (a bare object, a number, a forgotten return) is
 * reported through the failure path rather than cast blindly and mounted.
 */
function isIView(value: unknown): value is IView {
  if (typeof value !== 'object' || value === null) return false;
  const kind: unknown = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && IVIEW_KINDS.has(kind);
}

/** True when a value is a thenable, so the action returned a promise to await. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * True when a rejection is an abort. A cancelled fetch rejects with an `AbortError`,
 * which is a superseded navigation, not a route level failure.
 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Writes the document title. The document is absent when the router is driven
 * headlessly, in a controller test, so the check is a genuine runtime one and the
 * resolved title is still reported to the caller.
 */
function setDocumentTitle(value: string): void {
  const globals = globalThis as unknown as { document?: { title: string } };
  const doc = globals.document;
  if (doc === undefined) return;
  doc.title = value;
}

/**
 * Scrolls the page back to the top. Absent outside a browser, so the check is a
 * genuine runtime one.
 */
function scrollToTop(): void {
  const globals = globalThis as unknown as { scrollTo?: (x: number, y: number) => void };
  const scrollTo = globals.scrollTo;
  if (typeof scrollTo !== 'function') return;
  scrollTo.call(globals, 0, 0);
}

/**
 * True when the user has asked their operating system for less motion. Read on
 * every mount rather than cached, so changing the setting mid session takes effect
 * on the next navigation.
 */
function prefersReducedMotion(): boolean {
  return matchesMedia(REDUCED_MOTION_QUERY);
}

/**
 * The mutating verb a `_method` override names, or null when the value is not one
 * of them. A browser submits a form only as GET or POST, so a form reaches PUT,
 * PATCH, or DELETE by carrying the verb in a `_method` field, the same convention
 * server frameworks use. The match is case-insensitive.
 */
function methodOverride(raw: string): ActionMeta['verb'] | null {
  switch (raw.toLowerCase()) {
    case 'put':
      return 'PUT';
    case 'patch':
      return 'PATCH';
    case 'delete':
      return 'DELETE';
    default:
      return null;
  }
}

/**
 * The verb a navigation dispatches as. A navigation with no form data is a GET. A
 * form submission is a POST unless its form data carries a `_method` field naming a
 * mutating verb, in which case it dispatches as that verb and the field is removed
 * from the form data so it never reaches a bound DTO or a raw FormData parameter.
 */
function resolveVerb(formData: FormData | null): ActionMeta['verb'] {
  if (formData === null) return 'GET';
  const override = formData.get('_method');
  if (typeof override === 'string') {
    const mapped = methodOverride(override);
    if (mapped !== null) {
      formData.delete('_method');
      return mapped;
    }
  }
  return 'POST';
}

interface RouteEntry {
  readonly controllerClass: AnyConstructor;
  readonly methodName: string;
  readonly compiledPattern: CompiledPattern;
  readonly verb: ActionMeta['verb'];
  readonly specificity: number;
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

  const isBodyVerb =
    verb === 'POST' || verb === 'PUT' || verb === 'PATCH' || verb === 'DELETE';
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
  /** The dispatch scope that resolved this instance's dependencies, kept alive
   * with the retained instance and disposed when the instance is disposed. */
  readonly scope: Container;
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
  readonly #onActionError: ActionErrorReporter | undefined;
  readonly #onDispatch: ((info: RouterDispatchInfo) => void) | undefined;
  readonly #onMounted: ((info: MountedRoute) => void) | undefined;
  readonly #onPending: ((view: IView) => void) | undefined;
  readonly #onFailure: ((info: FailureInfo) => void) | undefined;
  readonly #clearOutlet: (() => void) | undefined;
  readonly #transitions: TransitionMode;
  readonly #pendingView: string | undefined;
  readonly #failureView: string | undefined;
  readonly #pendingDelay: number;
  readonly #title: string | ((page: string) => string) | undefined;
  #activeController: Controller | null = null;
  #activeControllerClass: AnyConstructor | null = null;
  #activeRoute: ResolvedRoute | null = null;
  // The dispatch scope that resolved the active controller's dependencies. Disposed
  // with the controller when it is not retained, or carried into the retention cache
  // and disposed when the retained instance is finally disposed.
  #activeScope: Container | null = null;
  // The abort controller of the navigation currently owning the outlet. Aborted
  // when that navigation is superseded or its controller is deactivated, so an in
  // flight fetch tied to this.signal is cancelled before the next action runs.
  #activeAbort: AbortController | null = null;
  // Incremented on every dispatch. A navigation started while an earlier one is
  // still running (an action calling navigateTo, for example) supersedes it, and
  // the superseded navigation stops before it commits ownership.
  #navigationSeq = 0;
  // Set by stop(). A stopped router commits nothing further; every in-flight
  // dispatch reads this after each awaited phase and returns without mutating state.
  #stopped = false;
  // The single navigate listener, kept so stop() can detach it. Null before attach()
  // and after stop().
  #navigateListener: ((event: NavigateEvent) => void) | null = null;

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
    this.#onActionError = options?.onActionError;
    this.#onDispatch = options?.onDispatch;
    this.#onMounted = options?.onMounted;
    this.#onPending = options?.onPending;
    this.#onFailure = options?.onFailure;
    this.#clearOutlet = options?.clearOutlet;
    this.#transitions = options?.transitions ?? 'auto';
    this.#pendingView = options?.pendingView;
    this.#failureView = options?.failureView;
    this.#pendingDelay = options?.pendingDelay ?? DEFAULT_PENDING_DELAY;
    this.#title = options?.title;
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
    scope: Container,
  ): Promise<boolean> {
    const classGuards = getClassGuards(entry.controllerClass);
    const proto = entry.controllerClass.prototype as object;
    const methodGuards = getMethodGuards(proto, entry.methodName);
    const allGuards = [...classGuards, ...methodGuards];
    if (allGuards.length === 0) return true;

    const route: ResolvedRoute = { pathname, params, query };
    for (const guardCtor of allGuards) {
      let permitted: boolean;
      try {
        const guard = this.#instantiateGuard(guardCtor, scope);
        permitted = Boolean(await Promise.resolve(guard.canActivate(route)));
      } catch (err) {
        // A returned false cancels quietly. A throw is a guard failure, not a
        // decision: report it and fail closed, so a broken guard is visible rather
        // than silently indistinguishable from a denial.
        const error = err instanceof Error ? err : new Error(String(err));
        this.#log?.error(
          `Guard ${guardCtor.name} for ${entry.controllerClass.name}.${entry.methodName} threw`,
          error,
        );
        this.#appErrorHandler?.(error, entry.methodName, {
          error,
          controller: entry.controllerClass.name,
          action: entry.methodName,
          route: pathname,
          phase: 'guard',
        });
        return false;
      }
      if (!permitted) return false;
    }
    return true;
  }

  #instantiateGuard(
    guardCtor: GuardConstructor,
    scope: Container,
  ): { canActivate: (...args: unknown[]) => unknown } {
    const deps = resolveInjectedArgs(scope, guardCtor, 'Guard');
    return new guardCtor(...deps);
  }

  /** Registers the Navigation API listener. Call once during bootstrap. */
  attach(): void {
    const listener = (event: NavigateEvent): void => {
      if (!event.canIntercept || event.hashChange || event.downloadRequest !== null) return;

      const navigationType: NavigationKind = event.navigationType;

      event.intercept({
        handler: async (): Promise<void> => {
          const formData = event.formData;
          await this.#handle(event.destination.url, formData, { navigationType });
        },
      });
    };
    this.#navigateListener = listener;
    navigation.addEventListener('navigate', listener);
  }

  /**
   * Tears the router down: detaches the single navigation listener so a later
   * navigation is not intercepted, cancels any in-flight navigation, and disposes
   * the active controller and every retained controller together with their scopes.
   * After this the router owns nothing live. Call once, from application teardown.
   */
  async stop(): Promise<void> {
    // Invalidate every in-flight navigation synchronously, before any await: a
    // dispatch waiting in a lazy loader or a guard reads the stopped flag and the
    // advanced generation after its next phase and returns without committing. The
    // abort cancels a dispatch that already holds the active signal.
    this.#stopped = true;
    this.#navigationSeq += 1;
    const abort = this.#activeAbort;
    this.#activeAbort = null;
    if (abort !== null) abort.abort();

    const listener = this.#navigateListener;
    if (listener !== null) {
      navigation.removeEventListener('navigate', listener);
      this.#navigateListener = null;
    }

    const active = this.#activeController;
    const activeRoute = this.#activeRoute;
    const activeScope = this.#activeScope;
    this.#activeController = null;
    this.#activeControllerClass = null;
    this.#activeRoute = null;
    this.#activeScope = null;
    if (active !== null) {
      const lifecycleError = this.#lifecycleErrorFor(active, activeRoute?.pathname ?? null);
      if (activeRoute !== null) {
        await active._deactivate(activeRoute, lifecycleError);
      }
      await active._dispose('app-stop', lifecycleError);
      activeScope?.dispose();
    }

    for (const [cls, entry] of [...this.#retentionCache]) {
      this.#retentionCache.delete(cls);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      await entry.instance._dispose('app-stop', this.#lifecycleErrorFor(entry.instance, null));
      entry.scope.dispose();
    }
  }

  /** Dispatches the current URL through the route table. Used for initial load. */
  async handleCurrentUrl(): Promise<void> {
    await this.#handle(location.href, null, { initialLoad: true });
  }

  /** Exposed for testing: directly dispatch a URL without a NavigateEvent. */
  async handle(url: string, formData: FormData | null): Promise<void> {
    return this.#handle(url, formData);
  }

  /**
   * Builds the handler that reports a throw from one of `instance`'s lifecycle
   * hooks. The controller and the hook are named so the failure is locatable, and
   * the application handler still sees it. A lifecycle failure does not take over
   * the outlet: the navigation may still produce a view.
   */
  #lifecycleErrorFor(instance: Controller, route: string | null): (err: Error, hookName: string) => void {
    return (err: Error, hookName: string): void => {
      this.#log?.error(`${instance.constructor.name}.${hookName} threw`, err);
      this.#appErrorHandler?.(err, hookName, {
        error: err,
        controller: instance.constructor.name,
        action: hookName,
        route,
        phase: 'lifecycle',
      });
    };
  }

  /**
   * True when a dispatch may no longer commit ownership: the router was stopped, a
   * newer navigation superseded this one, or this dispatch's own work was aborted.
   * Checked after every awaited phase and before every ownership mutation, so a
   * stale navigation cannot deactivate the winner, become active, or mount over it.
   */
  #isStale(navigationId: number, signal: AbortSignal): boolean {
    return this.#stopped || navigationId !== this.#navigationSeq || signal.aborted;
  }

  async #handle(
    url: string,
    formData: FormData | null,
    options?: DispatchOptions,
  ): Promise<void> {
    if (this.#stopped) return;

    const navigationId = ++this.#navigationSeq;
    const initialLoad = options?.initialLoad ?? false;

    // Every dispatch owns an abort controller from the very start, before any await,
    // so a navigation stalled in a lazy loader or a guard is already cancellable. A
    // newer dispatch aborts the previous one here, superseding it even before it
    // becomes the active controller; stop() aborts the latest the same way.
    const abort = new AbortController();
    const previousAbort = this.#activeAbort;
    this.#activeAbort = abort;
    if (previousAbort !== null) previousAbort.abort();

    await this.#resolvePendingLoaders();
    if (this.#isStale(navigationId, abort.signal)) return;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    const pathname = parsed.pathname;
    const verb = resolveVerb(formData);

    if (__DEV__) {
      this.#log?.debug('Navigation intercepted', { method: verb, url: pathname });
    }

    const matched = this.#findMatch(pathname, verb);
    if (matched === null) {
      this.#log?.warn('No route matched', { method: verb, url: pathname });
      if (!this.#isStale(navigationId, abort.signal)) this.#onNotFound?.(pathname);
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

    // The dispatch owns one child scope, created before guards. Guards and a freshly
    // constructed controller resolve from it, so a scoped guard dependency has the
    // navigation's lifetime. It is adopted as the controller's scope for a new
    // controller and disposed in the finally otherwise (denial, staleness, a retained
    // controller that keeps its own scope, or a construction failure).
    const dispatchScope = this.#container.createScope();
    let scopeAdopted = false;
    try {
      const permitted = await this.#runGuards(entry, params, pathname, query, dispatchScope);
      if (this.#isStale(navigationId, abort.signal)) return;
      if (!permitted) {
        this.#onDispatch?.({
          controllerClass: entry.controllerClass,
          controller: null,
          action: entry.methodName,
          params,
          query,
          result: null,
          cancelled: true,
          title: null,
        });
        return;
      }

      const nextRoute: ResolvedRoute = { pathname, params, query };

      await this.#deactivateCurrent();
      if (this.#isStale(navigationId, abort.signal)) return;

      const resolved = this.#resolveController(entry.controllerClass, dispatchScope);
      const controllerInstance = resolved.instance;
      scopeAdopted = resolved.isNew;
      // A retained controller is the same instance the last visit left behind, so what
      // that visit assigned is cleared before this one runs.
      controllerInstance._resetForDispatch();
      // A fresh signal every dispatch, including a second visit to a retained
      // controller, whose previous signal was aborted when it was superseded.
      controllerInstance._setSignal(abort.signal);
      const lifecycleError = this.#lifecycleErrorFor(controllerInstance, nextRoute.pathname);

      await controllerInstance._runInit(lifecycleError);
      if (this.#isStale(navigationId, abort.signal)) {
        // Built a controller for a navigation that has since been superseded or
        // stopped: dispose it (and its scope, if new) before returning, so a stale
        // dispatch leaks no controller or scope.
        await controllerInstance._dispose('navigation', lifecycleError);
        return;
      }

      // Commit: this dispatch is current, so it now owns the active controller.
      this.#activeScope = resolved.scope;
      this.#activeController = controllerInstance;
      this.#activeControllerClass = entry.controllerClass;
      this.#activeRoute = nextRoute;

      await controllerInstance._activate(nextRoute, lifecycleError);
      if (this.#isStale(navigationId, abort.signal)) return;

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
      // runs, so the action can inspect this.hasErrors().
      if (Object.keys(fieldErrors).length > 0) {
        controllerInstance._primeErrors(fieldErrors);
      }

      const actionFn = proto[entry.methodName];
      if (typeof actionFn !== 'function') return;

      const bound = (actionFn as (...a: unknown[]) => unknown).bind(controllerInstance);

      let actionResult: unknown;
      let pendingShown = false;
      try {
        // Inspect the return value before awaiting it. A synchronous action never shows
        // a pending view, so its behaviour is byte for byte unchanged.
        const returned: unknown = bound(...args);
        if (isThenable(returned)) {
          pendingShown = await this.#maybeShowPending(
            returned,
            entry,
            controllerInstance,
            params,
            query,
            navigationId,
            abort,
          );
          actionResult = await returned;
        } else {
          actionResult = returned;
        }
      } catch (err) {
        // A cancelled action is a superseded navigation, not a route failure: the user
        // who navigated away must not see an error page mounted behind them.
        if (this.#isStale(navigationId, abort.signal) || isAbortError(err)) {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        await this.#reportActionError(entry, controllerInstance, error, params, query, pathname);
        return;
      }

      // An action that navigated imperatively has already started the navigation that
      // supersedes this one. Stop before rendering, so the view this action produced
      // does not land on top of the one the new navigation is mounting.
      if (this.#isStale(navigationId, abort.signal)) {
        if (__DEV__) {
          this.#log?.debug('Navigation superseded before render', { url: pathname });
        }
        return;
      }

      // An action that returned something that is not a view result cannot be mounted.
      // Route it through the same failure path as a throw, so a forgotten or wrong
      // return is a reported failure rather than an unobserved rejection.
      if (!isIView(actionResult)) {
        const error = new Error(
          `[TypeMVC] Action "${entry.controllerClass.name}.${entry.methodName}" did not return ` +
            `a view result. Return View(), PartialView(), Redirect(), RedirectReplace(), or ` +
            `EmptyView() from an action.`,
        );
        await this.#reportActionError(entry, controllerInstance, error, params, query, pathname);
        return;
      }
      const iview: IView = actionResult;

      // Resolved once, here, so the document title write, the dispatch record, and the
      // route announcement all consume the same string rather than each recomputing it.
      const title = this.#resolveTitle(iview, entry, controllerInstance);
      if (title !== null) {
        setDocumentTitle(title);
      }

      this.#onDispatch?.({
        controllerClass: entry.controllerClass,
        controller: controllerInstance,
        action: entry.methodName,
        params,
        query,
        result: iview,
        cancelled: false,
        title,
      });

      let mounted: boolean;
      try {
        mounted = await this.#handleView(
          iview,
          entry,
          controllerInstance,
          params,
          query,
          true,
          pathname,
          abort.signal,
        );
      } catch (err) {
        // A throw while rendering the normal view (a broken template, a failing load)
        // is routed through the same failure path as an action throw, rather than
        // rejecting out of the handler unobserved. A superseded or cancelled render is
        // an abandoned navigation and is dropped silently.
        if (this.#isStale(navigationId, abort.signal) || isAbortError(err)) {
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        await this.#reportActionError(entry, controllerInstance, error, params, query, pathname, 'render');
        return;
      }
      // A newer navigation may have won while the renderer awaited its module. The
      // renderer bails on the abort signal before writing, so this guards the report.
      if (this.#isStale(navigationId, abort.signal)) return;
      if (mounted) {
        this.#resetScroll(options?.navigationType, parsed.hash);
        this.#onMounted?.({ pathname, initialLoad, title });
      } else if (pendingShown) {
        // A pending view is on screen but the result mounts nothing (a redirect or an
        // empty view), so the skeleton must not be left behind.
        this.#clearOutlet?.();
      }
      this.#log?.info('Navigation complete', { url: pathname });
    } finally {
      // A new controller adopted the dispatch scope as its own (disposed with the
      // controller). Otherwise the scope held only guard services for this navigation
      // (a retained controller, a denial, staleness, or a construction failure) and
      // is disposed here.
      if (!scopeAdopted) dispatchScope.dispose();
    }
  }

  /**
   * The page title for this navigation, or null when it resolved none, in which case
   * the document title is left exactly as it was.
   *
   * A result that renders no view resolves no title: a redirect's destination sets
   * its own, and an empty result has not changed the page the user is looking at.
   */
  #resolveTitle(iview: IView, entry: RouteEntry, instance: Controller): string | null {
    if (iview.kind !== 'view' && iview.kind !== 'partial') return null;

    const proto = entry.controllerClass.prototype as object;
    const page =
      instance._getTitle() ??
      getMethodTitle(proto, entry.methodName) ??
      getClassTitle(entry.controllerClass) ??
      (typeof this.#title === 'string' ? this.#title : undefined);

    if (page === undefined) return null;
    return this.#applyTitleTemplate(page);
  }

  /**
   * Wraps a route's title in the application template, if there is one. The template
   * is application code the framework calls, so a throw in it is contained: the
   * navigation has otherwise succeeded, and a cosmetic failure must not become a
   * blank page. The title is left unchanged instead.
   */
  #applyTitleTemplate(page: string): string | null {
    const template = this.#title;
    if (typeof template !== 'function') return page;

    try {
      return template(page);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#log?.error(
        'The application title template threw, so the document title is unchanged',
        error,
      );
      return null;
    }
  }

  /**
   * A same document navigation keeps the scroll offset of the route being left, so a
   * push to a new route would open it at wherever the user had scrolled the last one
   * to. The browser handles the other two cases by itself, and both are left alone:
   * it restores the offset on a traversal, and it scrolls to the fragment when the
   * destination has one, which works because the view is in the DOM before the
   * navigation's handler settles.
   */
  #resetScroll(navigationType: NavigationKind | undefined, hash: string): void {
    if (navigationType !== 'push' && navigationType !== 'replace') return;
    if (hash !== '') return;
    scrollToTop();
  }

  /**
   * Reports a throw from an action: the controller's own onActionError hook, then
   * the application handler, then the logger (always, so the failure is visible with
   * no handler registered), in that order. Then, if a failure view resolves, it
   * mounts with a narrow error model inside the layout chain. Only when nothing
   * claims the failure does onActionError take over the outlet, which preserves the
   * behaviour of every application that adds no failure view.
   */
  async #reportActionError(
    entry: RouteEntry,
    instance: Controller,
    error: Error,
    params: Readonly<Record<string, string>>,
    query: URLSearchParams,
    route: string,
    phase: ErrorPhase = 'action',
  ): Promise<void> {
    _invokeOnActionError(instance, error, entry.methodName);
    this.#appErrorHandler?.(error, entry.methodName, {
      error,
      controller: entry.controllerClass.name,
      action: entry.methodName,
      route,
      phase,
    });
    this.#log?.error(
      `Action ${entry.controllerClass.name}.${entry.methodName} threw`,
      error,
    );

    const failurePath = this.#resolveFailurePath(entry);
    if (failurePath !== null) {
      const failureView: IView = {
        kind: 'view',
        path: failurePath,
        model: this.#failureModel(error) as unknown as Record<string, unknown>,
      };
      try {
        await this.#handleView(failureView, entry, instance, params, query, true, route);
        this.#onFailure?.({
          controllerClass: entry.controllerClass,
          controller: instance,
          action: entry.methodName,
          error,
          view: failureView,
        });
        return;
      } catch (renderErr) {
        // The failure view itself failed to render. Do not recurse: fall back to the
        // outlet reporter, so a broken error page cannot loop.
        const e = renderErr instanceof Error ? renderErr : new Error(String(renderErr));
        this.#log?.error(`Failure view failed to render: ${failurePath}`, e);
      }
    }

    this.#onFailure?.({
      controllerClass: entry.controllerClass,
      controller: instance,
      action: entry.methodName,
      error,
      view: null,
    });
    this.#onActionError?.(entry.controllerClass.name, entry.methodName, error);
  }

  /**
   * Shows the pending view if the action outlives the delay threshold. Races the
   * action against a timer and mounts the pending view only if the timer wins, so a
   * fast action never flashes a skeleton. Returns true when a pending view was
   * shown. The pending view mounts through the normal path, inside the same layout
   * chain, with a null model.
   */
  async #maybeShowPending(
    action: PromiseLike<unknown>,
    entry: RouteEntry,
    instance: Controller,
    params: Readonly<Record<string, string>>,
    query: URLSearchParams,
    navigationId: number,
    abort: AbortController,
  ): Promise<boolean> {
    const pendingPath = this.#resolvePendingPath(entry);
    if (pendingPath === null) return false;

    const settled = Promise.resolve(action).then(
      () => 'settled' as const,
      () => 'settled' as const,
    );
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timer = new Promise<'timer'>((resolve) => {
      timerId = setTimeout(() => { resolve('timer'); }, this.#pendingDelay);
    });

    const winner = await Promise.race([settled, timer]);
    if (timerId !== undefined) clearTimeout(timerId);
    if (winner !== 'timer') return false;

    // The action outran the timer, but a newer navigation may have started or this
    // one may have been cancelled while the timer ran. Do not paint a skeleton onto
    // a navigation that is no longer current.
    if (navigationId !== this.#navigationSeq || abort.signal.aborted) return false;

    const pendingView: IView = { kind: 'view', path: pendingPath, model: null };
    this.#onPending?.(pendingView);
    await this.#handleView(pendingView, entry, instance, params, query, false, null);
    return true;
  }

  /** The pending view path for this action: action, then controller, then app default. */
  #resolvePendingPath(entry: RouteEntry): string | null {
    const proto = entry.controllerClass.prototype as object;
    return (
      getMethodPending(proto, entry.methodName) ??
      getClassPending(entry.controllerClass) ??
      this.#pendingView ??
      null
    );
  }

  /** The failure view path for this action: action, then controller, then app default. */
  #resolveFailurePath(entry: RouteEntry): string | null {
    const proto = entry.controllerClass.prototype as object;
    return (
      getMethodFailure(proto, entry.methodName) ??
      getClassFailure(entry.controllerClass) ??
      this.#failureView ??
      null
    );
  }

  /**
   * The model handed to a failure view: a deliberately narrow shape, never the raw
   * Error. A development build surfaces the message and name to make the failure
   * legible; a production build shows a generic message, so a stack, an internal URL
   * or a database message an exception carried never reaches the DOM.
   */
  #failureModel(error: Error): FailureModel {
    if (__DEV__) {
      return { message: error.message, name: error.name };
    }
    return { message: 'Something went wrong.', name: 'Error' };
  }

  async #deactivateCurrent(): Promise<void> {
    // The outgoing navigation's in-flight work was already cancelled when this
    // dispatch started and aborted the previous dispatch's signal, so nothing is
    // aborted here: the active abort is now this dispatch's own.
    if (this.#activeController === null || this.#activeControllerClass === null || this.#activeRoute === null) return;

    const instance = this.#activeController;
    const cls = this.#activeControllerClass;
    const route = this.#activeRoute;
    const scope = this.#activeScope;

    this.#activeController = null;
    this.#activeControllerClass = null;
    this.#activeRoute = null;
    this.#activeScope = null;

    const lifecycleError = this.#lifecycleErrorFor(instance, route.pathname);

    await instance._deactivate(route, lifecycleError);

    const meta = getRetentionMeta(cls);
    if (meta !== undefined && scope !== null) {
      const existing = this.#retentionCache.get(cls);
      if (existing?.timer !== undefined) {
        clearTimeout(existing.timer);
      }
      const entry: RetentionCacheEntry = {
        instance,
        scope,
        ttlMs: meta.ttlMs,
        timer: meta.ttlMs !== undefined
          ? setTimeout((): void => { void this.#evict(cls, 'ttl-expired'); }, meta.ttlMs)
          : undefined,
      };
      this.#retentionCache.set(cls, entry);
    } else {
      // The controller cleans up first, so a teardown that reads an injected
      // dependency still sees it, then the scope disposes that dependency.
      await instance._dispose('navigation', lifecycleError);
      scope?.dispose();
    }
  }

  async #evict(cls: AnyConstructor, reason: DisposeReason): Promise<void> {
    const entry = this.#retentionCache.get(cls);
    if (entry === undefined) return;
    this.#retentionCache.delete(cls);
    await entry.instance._dispose(reason, this.#lifecycleErrorFor(entry.instance, null));
    entry.scope.dispose();
  }

  /**
   * Returns true when a view reached the outlet, so only a real mount is reported.
   * `transition` is false for a pending mount, so a navigation that mounts a pending
   * view and then a real view fires one view transition, not two.
   */
  async #handleView(
    iview: IView,
    entry: RouteEntry,
    controllerInstance: Controller,
    params: Readonly<Record<string, string>>,
    query: URLSearchParams,
    transition: boolean,
    route: string | null,
    signal?: AbortSignal,
  ): Promise<boolean> {
    switch (iview.kind) {
      case 'redirect':
        navigation.navigate(iview.path);
        return false;
      case 'redirect-replace':
        navigation.navigate(iview.path, { history: 'replace' });
        return false;
      case 'empty':
        return false;
      case 'view':
      case 'partial': {
        if (this.#viewRenderer === undefined) return false;

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
          route,
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
          controllerInstance._getFieldErrors(),
          renderPartial,
          this.#componentMap,
        );

        const layoutChain = resolveLayoutChain(entry.controllerClass, entry.methodName, this.#layoutMap);
        await this.#mountView(iview, context, resolvedPath, layoutChain, transition, signal);
        return true;
      }
    }
  }

  /**
   * Whether this mount runs inside a view transition. Reduced motion is read here,
   * per mount, rather than cached when the router was built, so a user who turns
   * the system setting on mid session is respected on the next navigation.
   */
  #useTransition(): boolean {
    if (this.#transitions === 'off') return false;
    if (this.#transitions === 'on') return true;
    return !prefersReducedMotion();
  }

  async #mountView(
    iview: IView,
    context: ViewContext,
    resolvedPath: string,
    layoutChain: LayoutConstructor[],
    withTransition: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const render = this.#viewRenderer;
    if (render === undefined) return;

    const mount = (): Promise<void> =>
      render(iview, context, this.#outlet, resolvedPath, layoutChain, signal);

    // Cast to Record<string, unknown> so the startViewTransition check is valid:
    // Document in older browsers lacks startViewTransition, making this a genuine runtime check.
    const doc = document as unknown as Record<string, unknown>;
    const startViewTransition = doc.startViewTransition;

    if (!withTransition || typeof startViewTransition !== 'function' || !this.#useTransition()) {
      try {
        await mount();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#log?.error(`View load failed: ${resolvedPath}`, error);
        throw error;
      }
      return;
    }

    // The render owns the transition's update callback, so a failure inside it is
    // carried out rather than thrown: throwing there rejects the transition's own
    // promises, which nothing is listening to.
    const outcome: { error: Error | null } = { error: null };

    const transition = (
      startViewTransition as (callback: () => Promise<void>) => ViewTransitionHandle
    ).call(document, async (): Promise<void> => {
      try {
        await mount();
      } catch (err) {
        outcome.error = err instanceof Error ? err : new Error(String(err));
      }
    });

    // updateCallbackDone settles when the DOM holds the new view, which is what a
    // caller is waiting for. `finished` settles only when the cross fade has played
    // out, and awaiting that would hold the navigation open for the length of the
    // animation.
    await transition.updateCallbackDone;

    if (outcome.error !== null) {
      this.#log?.error(`View load failed: ${resolvedPath}`, outcome.error);
      throw outcome.error;
    }
  }

  #findMatch(pathname: string, verb: ActionMeta['verb']): MatchedRoute | null {
    for (const entry of this.#routeTable) {
      // A catch-all is an ordinary route with the lowest specificity: it honors its
      // declared verb like any other, so a GET catch-all cannot claim a POST.
      if (entry.verb !== verb) continue;
      const routeMatch = matchRoute(entry.compiledPattern, pathname);
      if (routeMatch !== null) {
        return { entry, routeMatch };
      }
    }
    return null;
  }

  /**
   * The controller for this dispatch, the scope its dependencies were resolved from,
   * and whether it was freshly built. A retained instance is returned with the scope
   * it was built with, so its scoped dependencies live as long as the retained
   * controller does, and `isNew` is false so the dispatch keeps its guard-only scope
   * separate. A fresh instance is built in the dispatch scope, which the caller then
   * adopts as the controller's own scope. A construction failure leaves the dispatch
   * scope for the caller's finally to dispose.
   */
  #resolveController(
    cls: AnyConstructor,
    dispatchScope: Container,
  ): { instance: Controller; scope: Container; isNew: boolean } {
    const cached = this.#retentionCache.get(cls);
    if (cached !== undefined) {
      if (cached.timer !== undefined) {
        clearTimeout(cached.timer);
      }
      this.#retentionCache.delete(cls);
      if (__DEV__) {
        this.#log?.debug('Controller reactivated from retention cache', { controller: cls.name });
      }
      return { instance: cached.instance, scope: cached.scope, isNew: false };
    }
    return { instance: this.#instantiate(cls, dispatchScope), scope: dispatchScope, isNew: true };
  }

  #instantiate(cls: AnyConstructor, scope: Container): Controller {
    const deps = resolveInjectedArgs(scope, cls, 'Controller');
    const instance = new cls(...deps) as Controller;
    // Assigned after construction, never as a constructor parameter: a controller's
    // parameters are its @inject contract, and a framework parameter would break the
    // rule that a subclass with no constructor inherits its base's injection metadata.
    instance._setRouter(this);
    return instance;
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
