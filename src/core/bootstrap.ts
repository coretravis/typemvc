import type { AppBuilder, AppConfig, AppHandle, ComponentFunction, ComponentGlob, ErrorHandler, IPlugin, IRouter, ViewContext, LayoutConstructor, LayoutGlob, PartialGlob, TmvcViewFunction } from '../types/index.js';
import type { ILogger, ILoggerFactory } from '../logging/types.js';
import type { PartialRenderer } from './context.js';
import { Container } from '../di/container.js';
import { Router } from '../router/router.js';
import type { MountedRoute } from '../router/router.js';
import { ROUTER } from '../router/tokens.js';
import { createRouteAnnouncer } from './announcer.js';
import { getControllerMeta } from './decorators.js';
import { DEFAULT_VIEWS_ROOT } from './view-resolution.js';
import { Fragment } from '../renderer/fragment.js';
import { LoggerFactory } from '../logging/factory.js';
import { ConsoleLogProvider } from '../logging/console-provider.js';
import { LOGGER_FACTORY } from '../logging/index.js';
import { applyLayoutChain, defineLayout, _setLayoutName, _setLayoutParent } from '../layout/layout.js';
import type { LayoutMap } from '../layout/layout.js';
import { _initControllerLogger } from './controller.js';
import { _setComponentRegistry } from './component-registry.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type AnyConstructor = new (...args: unknown[]) => unknown;
type ControllerLoader = () => Promise<{ readonly default: AnyConstructor }>;

interface PendingRegistration {
  readonly kind: 'singleton' | 'scoped' | 'transient';
  readonly token: symbol;
  readonly factory: (c: Container) => unknown;
}

// ---------------------------------------------------------------------------
// AppBuilderImpl
// ---------------------------------------------------------------------------

class AppBuilderImpl implements AppBuilder {
  readonly #pendingRegistrations: PendingRegistration[] = [];
  readonly #pendingRoutes: (AnyConstructor | ControllerLoader)[] = [];
  readonly #startupTokens: symbol[] = [];
  #errorHandler: ErrorHandler | undefined;
  #sealed = false;

  #assertNotSealed(): void {
    if (this.#sealed) {
      throw new Error(
        '[TypeMVC] AppBuilder is sealed. Registrations are not accepted after bootstrap() completes.',
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- required to satisfy AppBuilder interface
  singleton<T>(token: symbol, factory: (c: Container) => T): AppBuilder {
    this.#assertNotSealed();
    this.#pendingRegistrations.push({ kind: 'singleton', token, factory });
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- required to satisfy AppBuilder interface
  scoped<T>(token: symbol, factory: (c: Container) => T): AppBuilder {
    this.#assertNotSealed();
    this.#pendingRegistrations.push({ kind: 'scoped', token, factory });
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- required to satisfy AppBuilder interface
  transient<T>(token: symbol, factory: (c: Container) => T): AppBuilder {
    this.#assertNotSealed();
    this.#pendingRegistrations.push({ kind: 'transient', token, factory });
    return this;
  }

  route(controllerOrLoader: AnyConstructor | ControllerLoader): AppBuilder {
    this.#assertNotSealed();
    this.#pendingRoutes.push(controllerOrLoader);
    return this;
  }

  use(plugin: IPlugin): AppBuilder {
    this.#assertNotSealed();
    plugin.install(this);
    return this;
  }

  onError(handler: ErrorHandler): AppBuilder {
    this.#assertNotSealed();
    this.#errorHandler = handler;
    return this;
  }

  onStart(token: symbol): AppBuilder {
    this.#assertNotSealed();
    // A token registered twice starts once: a plugin and the application can both
    // ask for the same task without it running two of them.
    if (!this.#startupTokens.includes(token)) {
      this.#startupTokens.push(token);
    }
    return this;
  }

  _seal(loggerFactory?: ILoggerFactory): {
    container: Container;
    routes: (AnyConstructor | ControllerLoader)[];
    errorHandler: ErrorHandler | undefined;
    startupTokens: symbol[];
  } {
    this.#sealed = true;
    const container = new Container(null, loggerFactory);

    for (const reg of this.#pendingRegistrations) {
      if (__DEV__ && loggerFactory !== undefined) {
        loggerFactory.create('TypeMVC.Bootstrap').debug('DI registration', {
          kind: reg.kind,
          token: String(reg.token.description),
        });
      }
      container[reg.kind](reg.token, reg.factory);
    }

    return {
      container,
      routes: this.#pendingRoutes.slice(),
      errorHandler: this.#errorHandler,
      startupTokens: this.#startupTokens.slice(),
    };
  }
}

// ---------------------------------------------------------------------------
// Startup tasks
// ---------------------------------------------------------------------------

/** A task that was resolved, so it is a task the application handle can stop. */
interface StartedTask {
  readonly token: symbol;
  readonly instance: unknown;
}

type StartupHook = () => void | Promise<void>;

/**
 * Returns the named hook bound to the instance it came from, or undefined when the
 * instance does not have one. Implementing the startup task interface is optional:
 * a service that does its work in its constructor has neither hook.
 */
function getStartupHook(instance: unknown, name: 'start' | 'stop'): StartupHook | undefined {
  if (typeof instance !== 'object' || instance === null) return undefined;
  const hook = (instance as Record<string, unknown>)[name];
  if (typeof hook !== 'function') return undefined;
  return (hook as StartupHook).bind(instance);
}

/**
 * Fails fast when the Navigation API is absent.
 */
function assertNavigationApi(): void {
  const nav = (globalThis as { navigation?: unknown }).navigation;
  if (nav === undefined || nav === null) {
    throw new Error(
      '[TypeMVC] The Navigation API is required but not available in this environment. ' +
        'TypeMVC routing is built on it. It ships in Chromium browsers (Chrome and Edge 102 ' +
        'and later) and Safari 18 and later; for any other browser, load a Navigation API ' +
        'polyfill before calling bootstrap().',
    );
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Reports a startup task failure: the token is named so the failure is locatable,
 * and the application handler still sees it. A failed task never stops the tasks
 * after it, and never stops the first navigation: a broken analytics listener must
 * not produce a blank page.
 */
function reportStartupFailure(
  log: ILogger,
  appErrorHandler: ErrorHandler | undefined,
  token: symbol,
  what: string,
  err: unknown,
): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const name = String(token.description);
  log.error(`Startup task "${name}" ${what}`, error);
  appErrorHandler?.(error, name, {
    error,
    controller: null,
    action: null,
    route: null,
    phase: 'startup',
  });
}

/**
 * Resolves each startup token in registration order and calls its start hook.
 * Resolution is itself meaningful: it is what constructs the singleton. An async
 * start is not awaited, so no user promise sits in front of the first paint; its
 * rejection is reported rather than left unhandled.
 */
function startTasks(
  tokens: readonly symbol[],
  container: Container,
  log: ILogger,
  appErrorHandler: ErrorHandler | undefined,
): StartedTask[] {
  const started: StartedTask[] = [];

  for (const token of tokens) {
    let instance: unknown;
    try {
      instance = container.resolve<unknown>(token);
    } catch (err) {
      reportStartupFailure(log, appErrorHandler, token, 'could not be resolved, so it did not start', err);
      continue;
    }

    started.push({ token, instance });

    const start = getStartupHook(instance, 'start');
    if (start === undefined) continue;

    try {
      const result = start();
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((err: unknown) => {
          reportStartupFailure(log, appErrorHandler, token, 'threw from start()', err);
        });
      }
    } catch (err) {
      reportStartupFailure(log, appErrorHandler, token, 'threw from start()', err);
    }
  }

  return started;
}

function createAppHandle(
  container: Container,
  started: StartedTask[],
  ready: Promise<void>,
  teardown: () => Promise<void>,
  log: ILogger,
  appErrorHandler: ErrorHandler | undefined,
): AppHandle {
  let stopped = false;

  return {
    container,
    ready,
    stop: async (): Promise<void> => {
      if (stopped) return;
      stopped = true;

      // Stop the startup tasks first: a task may hold the router or the DOM the
      // teardown then detaches and disposes.
      for (const task of started) {
        const stop = getStartupHook(task.instance, 'stop');
        if (stop === undefined) continue;
        try {
          await Promise.resolve(stop());
        } catch (err) {
          reportStartupFailure(log, appErrorHandler, task.token, 'threw from stop()', err);
        }
      }

      started.length = 0;

      await teardown();
    },
  };
}

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

// A layout file's @parent compiles to a `parent` named export holding the name of
// the layout that wraps it. That name can only be resolved once every layout in
// the glob exists, so the map is built in two passes: create, then link.
interface PendingParentLink {
  readonly child: LayoutConstructor;
  readonly childName: string;
  readonly parentName: string;
}

function buildLayoutMap(glob: LayoutGlob): LayoutMap {
  const map = Object.create(null) as Record<string, LayoutConstructor>;
  const links: PendingParentLink[] = [];

  const layoutSources = Object.create(null) as Record<string, string>;
  for (const [path, mod] of Object.entries(glob)) {
    const filename = path.split('/').at(-1) ?? path;
    const name = filename.replace(/\.[^.]+$/, '');
    const priorPath = layoutSources[name];
    if (priorPath !== undefined) {
      throw new Error(
        `[TypeMVC] Duplicate layout name "${name}" from "${priorPath}" and "${path}". ` +
          'A layout name is its file basename and must be unique. Rename one of the files.',
      );
    }
    layoutSources[name] = path;
    const child = defineLayout({ template: mod.default });
    _setLayoutName(child, name);
    map[name] = child;
    if (mod.parent !== undefined) {
      links.push({ child, childName: name, parentName: mod.parent });
    }
  }

  for (const link of links) {
    const parent = map[link.parentName];
    if (parent === undefined) {
      throw new Error(
        `[TypeMVC] Layout "${link.childName}" declares @parent "${link.parentName}", ` +
          'which is not registered. Register it via the "layouts" eager glob in bootstrap().',
      );
    }
    _setLayoutParent(link.child, parent);
  }

  return map;
}

function buildComponentMap(glob: ComponentGlob): Readonly<Record<string, ComponentFunction>> {
  const map = Object.create(null) as Record<string, ComponentFunction>;
  const componentSources = Object.create(null) as Record<string, string>;
  for (const [path, mod] of Object.entries(glob)) {
    const filename = path.split('/').at(-1) ?? path;
    const name = filename.replace(/\.[^.]+$/, '');
    const priorPath = componentSources[name];
    if (priorPath !== undefined) {
      throw new Error(
        `[TypeMVC] Duplicate component name "${name}" from "${priorPath}" and "${path}". ` +
          'A component name is its file basename and must be unique. Rename one of the files.',
      );
    }
    componentSources[name] = path;
    map[name] = mod.default;
  }
  return map;
}

function buildMakePartialRenderer(
  partials: PartialGlob,
  viewsRoot: string,
  componentMap?: Readonly<Record<string, ComponentFunction>>,
): (router: IRouter, params: Readonly<Record<string, string>>, query: URLSearchParams) => PartialRenderer {
  const base = viewsRoot.endsWith('/') ? viewsRoot : `${viewsRoot}/`;

  return (router, params, query): PartialRenderer => {
    const self: PartialRenderer = (name: string, data?: Readonly<Record<string, unknown>>): Fragment => {
      const candidates = [
        `${base}${name}`,
        `${base}${name}.tmvc`,
        `/${base}${name}`,
        `/${base}${name}.tmvc`,
      ];
      let templateFn: TmvcViewFunction | undefined;
      for (const candidate of candidates) {
        const mod = partials[candidate];
        if (mod !== undefined) {
          templateFn = mod.default;
          break;
        }
      }
      if (templateFn === undefined) {
        throw new Error(
          `[TypeMVC] Partial "${name}" not found. ` +
            `Register it via the "partials" eager glob in bootstrap().`,
        );
      }
      // Build a minimal ViewContext for the partial. Partials have no controller,
      // no non-route methods, and no field errors. They inherit router/params/query
      // from the parent navigation and receive fresh errors.
      const ctx = Object.create(null) as Record<string, unknown>;
      ctx.model = Object.freeze(data ?? (Object.create(null) as Record<string, unknown>));
      ctx.data = Object.freeze(Object.create(null) as Record<string, unknown>);
      ctx.errors = Object.assign(Object.create(null) as Record<string, unknown>, { action: null });
      ctx.router = router;
      ctx.params = params;
      ctx.query = query;
      ctx.partial = self;
      if (componentMap !== undefined) {
        for (const [compName, fn] of Object.entries(componentMap)) {
          if (ctx[compName] === undefined) {
            ctx[compName] = fn;
          }
        }
      }
      return templateFn(ctx as unknown as ViewContext);
    };
    return self;
  };
}

/**
 * Starts the application: wires the DI container, registers controllers, routes,
 * layouts, and components from the configuration, installs the single navigation
 * listener, and renders the first view into the outlet element. Call once at
 * application entry.
 *
 * Registered startup tasks are resolved and started after the container is sealed
 * and before the first navigation.
 *
 * @param config - The application configuration (outlet, configure callback, and
 *   the view/layout/component globs).
 * @returns The running application. An entry file can ignore it; a test uses
 *   `stop()` to run the startup tasks' stop hooks.
 * @example
 * ```ts
 * bootstrap({
 *   outlet: document.getElementById('app')!,
 *   views: import.meta.glob('/views/**\/*.tmvc'),
 *   configure(app) {
 *     app.singleton(TODO_SERVICE, () => new TodoService());
 *     app.route(TodoController);
 *     app.onStart(TODO_SERVICE);
 *   },
 * });
 * ```
 */
export function bootstrap(config: AppConfig): AppHandle {
  const {
    outlet,
    configure,
    viewsRoot = DEFAULT_VIEWS_ROOT,
    views,
    partials,
    layouts,
    components,
    onError,
    title,
    transitions = 'auto',
    pendingView,
    failureView,
    pendingDelay,
    announce = true,
  } = config;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime null guard for JS callers; AppConfig.outlet is typed Element but JS may pass null
  if (outlet === null || outlet === undefined) {
    throw new Error(
      '[TypeMVC] No outlet element provided. Pass a valid DOM Element as "outlet" in AppConfig.',
    );
  }

  assertNavigationApi();

  const loggerFactory = new LoggerFactory(
    config.logging?.level ?? 'warn',
    config.logging?.provider ?? new ConsoleLogProvider(),
  );
  const log = loggerFactory.create('TypeMVC.Bootstrap');
  _initControllerLogger(loggerFactory.create('TypeMVC.Controller'));

  const builder = new AppBuilderImpl();
  configure(builder);
  const { container, routes, errorHandler, startupTokens } = builder._seal(loggerFactory);

  container.singleton(LOGGER_FACTORY, () => loggerFactory);

  const appErrorHandler = errorHandler ?? onError;

  let mountedFragment: Fragment | null = null;

  // Created before the first navigation and outside the outlet, so mounting a view
  // can never take the region with it.
  const routeAnnouncer = announce ? createRouteAnnouncer(outlet.ownerDocument) : null;

  const layoutMap = layouts !== undefined ? buildLayoutMap(layouts) : undefined;
  const componentMap = components !== undefined ? buildComponentMap(components) : undefined;
  // This application's own component map.
  const appComponentMap = componentMap ?? (Object.create(null) as Record<string, ComponentFunction>);
  _setComponentRegistry(appComponentMap);
  const makePartialRenderer = partials !== undefined
    ? buildMakePartialRenderer(partials, viewsRoot, componentMap)
    : undefined;

  const router = new Router(container, outlet, {
    ...(appErrorHandler !== undefined ? { appErrorHandler } : {}),
    ...(makePartialRenderer !== undefined ? { makePartialRenderer } : {}),
    ...(componentMap !== undefined ? { componentMap } : {}),
    ...(layoutMap !== undefined ? { layoutMap } : {}),
    ...(routeAnnouncer !== null
      ? {
          onMounted(info: MountedRoute): void {
            // The browser announces a fresh document load by itself, so announcing
            // the first navigation would say the page twice.
            if (info.initialLoad) return;
            // The pathname is what a route with no title of its own is left with. It
            // is worse than a title and much better than silence.
            routeAnnouncer.announce(info.title ?? info.pathname);
          },
        }
      : {}),
    ...(title !== undefined ? { title } : {}),
    ...(pendingView !== undefined ? { pendingView } : {}),
    ...(failureView !== undefined ? { failureView } : {}),
    ...(pendingDelay !== undefined ? { pendingDelay } : {}),
    viewsRoot,
    transitions,
    loggerFactory,
    clearOutlet(): void {
      // A pending view is on screen but the navigation mounts nothing (a redirect or
      // an empty result), so the skeleton must be taken down rather than left behind.
      if (mountedFragment !== null) {
        mountedFragment.dispose();
        mountedFragment = null;
      }
      outlet.replaceChildren();
    },
    onNotFound(pathname: string): void {
      if (mountedFragment !== null) {
        mountedFragment.dispose();
        mountedFragment = null;
      }
      outlet.replaceChildren();
      if (__DEV__) {
        outlet.textContent =
          `[TypeMVC] No route matched: ${pathname}. Register a @controller('*') to handle unmatched URLs.`;
      }
    },
    onActionError(controllerName: string, methodName: string, error: Error): void {
      if (mountedFragment !== null) {
        mountedFragment.dispose();
        mountedFragment = null;
      }
      outlet.replaceChildren();
      if (__DEV__) {
        outlet.textContent =
          `[TypeMVC] Action ${controllerName}.${methodName} threw, so it produced no view: ` +
          `${error.message}. Handle the failure in the action, or register app.onError() ` +
          `to render an error page.`;
      }
    },
    viewRenderer: async (
      _iview: unknown,
      context: ViewContext,
      outletEl: Element,
      resolvedPath: string,
      layoutChain: LayoutConstructor[],
      signal?: AbortSignal,
    ): Promise<void> => {
      const importPath = resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`;
      const loader = views?.[importPath] ?? views?.[`${importPath}.tmvc`];

      if (__DEV__) {
        log.debug('View glob lookup', { importPath, hit: loader !== undefined });
      }

      let mod: { readonly default: (ctx: ViewContext) => Fragment };
      if (loader !== undefined) {
        mod = (await loader()) as { readonly default: (ctx: ViewContext) => Fragment };
      } else {
        if (__DEV__) {
          log.debug('View fallback to dynamic import', { importPath });
        }
        try {
          mod = (await import(/* @vite-ignore */ importPath)) as {
            readonly default: (ctx: ViewContext) => Fragment;
          };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(`Module load failed: ${importPath}`, error);
          throw error;
        }
      }

      // A newer navigation may have won while this module loaded. Bail before
      // disposing the current view or writing the outlet, so a superseded render does
      // not clobber the view the winning navigation mounted.
      if (signal?.aborted === true) return;

      if (mountedFragment !== null) {
        mountedFragment.dispose();
        mountedFragment = null;
      }
      // Scope component-name resolution to this application for the duration of this
      // synchronous render, so a second application in the same module cannot claim it.
      _setComponentRegistry(appComponentMap);
      const viewFragment = mod.default(context);
      const fragment = applyLayoutChain(layoutChain, viewFragment, context);
      mountedFragment = fragment;
      outletEl.replaceChildren(...fragment.nodes);
      fragment.mount();
    },
  });

  // Registered here rather than in the configure callback: the router does not exist
  // until the container is sealed, and a service must be able to inject it with no
  // registration of its own.
  container.singleton(ROUTER, () => router);

  let hasCatchAll = false;
  for (const entry of routes) {
    const asClass = entry as AnyConstructor;
    if (getControllerMeta(asClass) !== undefined) {
      router.registerController(asClass);
      if (getControllerMeta(asClass)?.basePath === '*') hasCatchAll = true;
    } else if (typeof entry === 'function') {
      router.registerLoader(entry as ControllerLoader);
    }
  }

  if (__DEV__ && !hasCatchAll) {
    log.warn(
      'No catch-all route registered. Users navigating to unknown URLs will see a blank outlet. ' +
      "Add @controller('*') to handle unmatched URLs.",
    );
  }

  router.attach();

  // Started after the listener is attached, so a task that navigates is intercepted
  // by the router rather than reloading the document, and before the first
  // navigation, so the task owns whatever the first route renders against.
  const started = startTasks(startupTokens, container, log, appErrorHandler);

  // The first navigation reports its own action and render failures through the
  // error chain and resolves, so this settles when the first view is on screen or
  // its failure has been reported. The catch is a backstop for a failure outside
  // that path: it is reported here rather than left as an unobserved rejection, and
  // ready still resolves, so an application that never awaits it is unaffected.
  const ready: Promise<void> = router.handleCurrentUrl().catch((err: unknown): void => {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('The first navigation failed', error);
    appErrorHandler?.(error, 'bootstrap', {
      error,
      controller: null,
      action: null,
      route: null,
      phase: 'startup',
    });
  });

  log.info('App started', { controllers: routes.length, startupTasks: started.length });

  // The real unmount path: detach the navigation listener and dispose every live
  // controller through the router, dispose the mounted fragment and its effects, and
  // remove the announcer region, so stop() leaves nothing of the application behind.
  const teardown = async (): Promise<void> => {
    await router.stop();
    if (mountedFragment !== null) {
      mountedFragment.dispose();
      mountedFragment = null;
    }
    routeAnnouncer?.element.remove();
  };

  return createAppHandle(container, started, ready, teardown, log, appErrorHandler);
}
