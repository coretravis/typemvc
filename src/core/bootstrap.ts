import type { AppBuilder, AppConfig, ComponentFunction, ComponentGlob, ErrorHandler, IPlugin, IRouter, ViewContext, LayoutConstructor, LayoutGlob, PartialGlob, TmvcViewFunction } from '../types/index.js';
import type { ILoggerFactory } from '../logging/types.js';
import type { PartialRenderer } from './context.js';
import { Container } from '../di/container.js';
import { Router } from '../router/router.js';
import { getControllerMeta } from './decorators.js';
import { DEFAULT_VIEWS_ROOT } from './view-resolution.js';
import { Fragment } from '../renderer/fragment.js';
import { LoggerFactory } from '../logging/factory.js';
import { ConsoleLogProvider } from '../logging/console-provider.js';
import { LOGGER_FACTORY } from '../logging/index.js';
import { applyLayoutChain, defineLayout } from '../layout/layout.js';
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

  _seal(loggerFactory?: ILoggerFactory): {
    container: Container;
    routes: (AnyConstructor | ControllerLoader)[];
    errorHandler: ErrorHandler | undefined;
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
    };
  }
}

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

function buildLayoutMap(glob: LayoutGlob): LayoutMap {
  const map = Object.create(null) as Record<string, LayoutConstructor>;
  for (const [path, mod] of Object.entries(glob)) {
    const filename = path.split('/').at(-1) ?? path;
    const name = filename.replace(/\.[^.]+$/, '');
    if (__DEV__ && name in map) {
      console.warn(
        `[TypeMVC] Duplicate layout name "${name}" from "${path}". The previous registration is overwritten.`,
      );
    }
    map[name] = defineLayout({ template: mod.default });
  }
  return map;
}

function buildComponentMap(glob: ComponentGlob): Readonly<Record<string, ComponentFunction>> {
  const map = Object.create(null) as Record<string, ComponentFunction>;
  for (const [path, mod] of Object.entries(glob)) {
    const filename = path.split('/').at(-1) ?? path;
    const name = filename.replace(/\.[^.]+$/, '');
    if (__DEV__ && name in map) {
      console.warn(
        `[TypeMVC] Duplicate component name "${name}" from "${path}". The previous registration is overwritten.`,
      );
    }
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
 * @param config - The application configuration (outlet, configure callback, and
 *   the view/layout/component globs).
 * @example
 * ```ts
 * bootstrap({
 *   outlet: document.getElementById('app')!,
 *   views: import.meta.glob('/views/**\/*.tmvc'),
 *   configure(app) {
 *     app.singleton(TODO_SERVICE, () => new TodoService());
 *     app.route(TodoController);
 *   },
 * });
 * ```
 */
export function bootstrap(config: AppConfig): void {
  const { outlet, configure, viewsRoot = DEFAULT_VIEWS_ROOT, views, partials, layouts, components, onError } = config;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime null guard for JS callers; AppConfig.outlet is typed Element but JS may pass null
  if (outlet === null || outlet === undefined) {
    throw new Error(
      '[TypeMVC] No outlet element provided. Pass a valid DOM Element as "outlet" in AppConfig.',
    );
  }

  const loggerFactory = new LoggerFactory(
    config.logging?.level ?? 'warn',
    config.logging?.provider ?? new ConsoleLogProvider(),
  );
  const log = loggerFactory.create('TypeMVC.Bootstrap');
  _initControllerLogger(loggerFactory.create('TypeMVC.Controller'));

  const builder = new AppBuilderImpl();
  configure(builder);
  const { container, routes, errorHandler } = builder._seal(loggerFactory);

  container.singleton(LOGGER_FACTORY, () => loggerFactory);

  const appErrorHandler = errorHandler ?? onError;

  let mountedFragment: Fragment | null = null;

  const layoutMap = layouts !== undefined ? buildLayoutMap(layouts) : undefined;
  const componentMap = components !== undefined ? buildComponentMap(components) : undefined;
  _setComponentRegistry(componentMap ?? (Object.create(null) as Record<string, ComponentFunction>));
  const makePartialRenderer = partials !== undefined
    ? buildMakePartialRenderer(partials, viewsRoot, componentMap)
    : undefined;

  const router = new Router(container, outlet, {
    ...(appErrorHandler !== undefined ? { appErrorHandler } : {}),
    ...(makePartialRenderer !== undefined ? { makePartialRenderer } : {}),
    ...(componentMap !== undefined ? { componentMap } : {}),
    ...(layoutMap !== undefined ? { layoutMap } : {}),
    viewsRoot,
    loggerFactory,
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
    viewRenderer: async (
      _iview: unknown,
      context: ViewContext,
      outletEl: Element,
      resolvedPath: string,
      layoutChain: LayoutConstructor[],
    ): Promise<void> => {
      if (mountedFragment !== null) {
        mountedFragment.dispose();
        mountedFragment = null;
      }
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

      const viewFragment = mod.default(context);
      const fragment = applyLayoutChain(layoutChain, viewFragment, context);
      mountedFragment = fragment;
      outletEl.replaceChildren(...fragment.nodes);
    },
  });

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
  void router.handleCurrentUrl();

  log.info('App started', { controllers: routes.length });
}

// ---------------------------------------------------------------------------
// Built-in plugin stubs (§12.4)
// ---------------------------------------------------------------------------

/**
 * Returns the built-in authentication plugin. Pass it to `app.use()` in the
 * bootstrap configure callback to register auth services and expose
 * `context.auth` to views.
 */
export function useAuth(): IPlugin {
  return {
    name: 'auth',
    install(): void {
      // Phase 2: register auth service and expose context.auth
    },
  };
}

/**
 * Returns the built-in localization plugin. Pass it to `app.use()` in the
 * bootstrap configure callback to register localization services and expose
 * `context.locale` to views.
 */
export function useLocalization(): IPlugin {
  return {
    name: 'localization',
    install(): void {
      // Phase 2: register localisation service and expose context.locale
    },
  };
}
