import type { Fragment } from '../renderer/fragment.js';
import type { Container } from '../di/container.js';
import type { LogLevel, LogProvider } from '../logging/types.js';

// ---------------------------------------------------------------------------
// Router service
// ---------------------------------------------------------------------------

/**
 * The router service exposed to views as `context.router`. Use it to navigate
 * programmatically and to read the current path.
 */
export interface IRouter {
  navigateTo(path: string): void;
  replace(path: string): void;
  back(): void;
  forward(): void;
  readonly current: string;
}

// ---------------------------------------------------------------------------
// Context errors shape (§5.3)
// ---------------------------------------------------------------------------

/** Field-keyed validation messages plus action error from async non-route methods. */
export interface ContextErrors {
  readonly action: Error | null;
  readonly [field: string]: string | Error | null | undefined;
}

// ---------------------------------------------------------------------------
// View context object (§5.3)
// ---------------------------------------------------------------------------

/**
 * The sole access point for a view to data, framework services, and controller
 * methods. All keys are namespaced under reserved names or method names.
 */
export interface ViewContext {
  /** Strongly-typed view model passed explicitly from the controller action via View(). */
  readonly model: Readonly<Record<string, unknown>>;
  /** Ambient ViewBag accumulated on the controller instance via this.data.set(). Always loosely typed. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly errors: ContextErrors;
  readonly router: IRouter;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly partial: (name: string, data?: Readonly<Record<string, unknown>>) => Fragment;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Layout context (extends ViewContext with context.slot, see §11.2)
// ---------------------------------------------------------------------------

/**
 * Strongly-typed variant of ViewContext used by the Volar language plugin
 * to surface a typed context.model in .tmvc editor intellisense.
 *
 * Cannot be derived from ViewContext via intersection or Omit because
 * ViewContext carries a string index signature, which makes keyof collapse
 * to string and prevents property-level overrides.
 */
export interface TypedViewContext<T extends object> {
  readonly model: Readonly<T>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly errors: ContextErrors;
  readonly router: IRouter;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly partial: (name: string, data?: Readonly<Record<string, unknown>>) => Fragment;
  readonly [key: string]: unknown;
}

/** The context object passed to layout templates. Adds context.slot, which holds the rendered child Fragment. */
export interface LayoutContext extends ViewContext {
  readonly slot: Fragment;
}

// ---------------------------------------------------------------------------
// IView discriminated union
// ---------------------------------------------------------------------------

/**
 * The result type returned by all controller action methods.
 * The dispatcher switches on `kind` to decide how to handle the result.
 */
export type IView<T extends object = Record<string, unknown>> =
  | { readonly kind: 'view'; readonly path: string | null; readonly model: T | null }
  | { readonly kind: 'partial'; readonly path: string; readonly model: T | null }
  | { readonly kind: 'redirect'; readonly path: string; readonly replace: false }
  | { readonly kind: 'redirect-replace'; readonly path: string; readonly replace: true }
  | { readonly kind: 'empty' };

// ---------------------------------------------------------------------------

export interface AppOptions {
  name: string;
  version?: string;
}

export interface Plugin {
  name: string;
  setup: (app: unknown) => void | Promise<void>;
}

/**
 * A signal whose value can only be read. Produced by {@link computed} and used
 * where a value should be observed but not reassigned by the consumer.
 */
export interface ReadonlySignal<T> {
  readonly get: () => T;
}

/**
 * A writable reactive value produced by {@link signal}. Read with `get()`
 * (tracks the current effect) and update with `set()` or `update()`.
 */
export interface Signal<T> extends ReadonlySignal<T> {
  readonly set: (value: T) => void;
  readonly update: (fn: (current: T) => T) => void;
}

/**
 * Utility type for component prop values that may be static or reactive.
 * Pass a `Signal<T>` or `ReadonlySignal<T>` to get live DOM updates via
 * the html binding pipeline without any extra code in the component.
 *
 * Example:
 *   interface ButtonProps { label: Prop<string>; disabled?: Prop<boolean>; }
 */
export type Prop<T> = T | ReadonlySignal<T>;

/**
 * The signature every component's default export satisfies: a function taking a
 * props object and returning a rendered {@link Fragment}. Components declare
 * their own prop types via the `@props` directive in their `.tmvc` file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- props vary per component; any required to allow typed prop interfaces to be stored in the registry
export type ComponentFunction = (props: any) => Fragment;

/**
 * Eager glob map for component files, produced by
 * import.meta.glob('...', { eager: true }).
 * Each value is a pre-loaded module whose default export is a ComponentFunction.
 * The filename (without extension) becomes the context key: Button.ts -> context.Button.
 *
 * Example (in main.ts):
 *   const components = import.meta.glob('/src/components/**\/*.ts', { eager: true });
 *   bootstrap({ outlet, views, components, configure(app) { ... } });
 */
export type ComponentGlob = Readonly<Record<string, { readonly default: ComponentFunction }>>;

// ---------------------------------------------------------------------------
// Route guard (§10.4)
// ---------------------------------------------------------------------------

/**
 * A matched route passed to guards and controller lifecycle hooks: the resolved
 * pathname, the named route parameters, and the parsed query string.
 */
export interface ResolvedRoute {
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
}

/**
 * A route guard. Implement `canActivate` to allow or deny navigation; returning
 * false or a promise resolving to false cancels it. Apply with `@guard(...)`.
 * Guards are resolved from the DI container and may have injected dependencies.
 */
export interface IRouteGuard {
  canActivate(route: ResolvedRoute): boolean | Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Controller metadata types
// ---------------------------------------------------------------------------

/**
 * Reason passed to onDispose() and used internally by the retention cache.
 * 'navigation': fresh controller navigated away from (immediate disposal).
 * 'ttl-expired': retained controller TTL elapsed while inactive.
 */
export type DisposeReason = 'ttl-expired' | 'navigation';

/** Internal metadata stored by @retain(). Not exported from the public barrel. */
export interface RetentionMeta {
  readonly ttlMs: number | undefined;
}

export interface ControllerMeta {
  readonly basePath: string;
}

export interface ActionMeta {
  readonly verb: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly segment: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any[] required: unknown[] rejects guards with typed constructor params or typed canActivate signatures
export type GuardConstructor = new (...args: any[]) => { canActivate: (...args: any[]) => unknown };
export type LayoutConstructor = new (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Non-route method error handling types
// ---------------------------------------------------------------------------

/** Mutable container for the current non-route action error, set by the framework. */
export interface ActionErrorTarget {
  action: Error | null;
}

/**
 * Application-level error handler registered at bootstrap.
 * Receives errors from async non-route methods that are not handled by the
 * controller's onActionError override.
 */
export type ErrorHandler = (error: Error, methodName: string) => void;

// ---------------------------------------------------------------------------
// Application bootstrap types (§12.1 - §12.4)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any[] is required: unknown[] rejects typed constructor params, breaking @inject usage
type AnyConstructor = new (...args: any[]) => unknown;
type ControllerLoader = () => Promise<{ readonly default: AnyConstructor }>;

/**
 * Plugin interface for extending bootstrap with cross-cutting capabilities.
 * The install method receives the AppBuilder and may register DI tokens, routes,
 * or configure the application in any way supported by AppBuilder.
 */
export interface IPlugin {
  readonly name: string;
  install(app: AppBuilder): void;
}

/**
 * Fluent builder passed to the configure callback during bootstrap.
 * All registrations made here are applied atomically before the DI container
 * is sealed. No registrations are accepted after bootstrap() completes.
 */
export interface AppBuilder {
  singleton<T>(token: symbol, factory: (c: Container) => T): AppBuilder;
  scoped<T>(token: symbol, factory: (c: Container) => T): AppBuilder;
  transient<T>(token: symbol, factory: (c: Container) => T): AppBuilder;
  route(controllerOrLoader: AnyConstructor | ControllerLoader): AppBuilder;
  use(plugin: IPlugin): AppBuilder;
  onError(handler: ErrorHandler): AppBuilder;
}

/**
 * A map of view paths to lazy loader functions, produced by import.meta.glob.
 * Passing this to AppConfig allows Vite to statically bundle all .tmvc files
 * at build time while keeping the same code path in development.
 *
 * Example (in main.ts):
 *   const views = import.meta.glob('/views/**\/*.tmvc');
 *   bootstrap({ outlet, views, configure(app) { ... } });
 */
export type ViewGlob = Readonly<Record<string, () => Promise<unknown>>>;

/**
 * Eager glob map for partial templates, produced by
 * import.meta.glob('...', { eager: true }).
 * Each value is a pre-loaded module whose default export is a TmvcViewFunction.
 * Passing this to AppConfig makes context.partial() available in every view.
 *
 * Example (in main.ts):
 *   const partials = import.meta.glob('/src/partials/**\/*.tmvc', { eager: true });
 *   bootstrap({ outlet, views, partials, configure(app) { ... } });
 */
export type PartialGlob = Readonly<Record<string, { readonly default: TmvcViewFunction }>>;

/**
 * Eager glob map for layout .tmvc files, produced by
 * import.meta.glob('...', { eager: true }).
 * Each value is a pre-loaded module whose default export is the compiled layout
 * template function. Bootstrap calls defineLayout({ template }) automatically
 * for each entry: no .ts wrapper file is needed.
 *
 * Example (in main.ts):
 *   const layouts = import.meta.glob('/src/layouts/**\/*.tmvc', { eager: true }) as LayoutGlob;
 *   bootstrap({ outlet, views, layouts, configure(app) { ... } });
 *
 * Controllers reference layouts by filename (without extension):
 *   @layout('AppLayout')
 */
export type LayoutGlob = Readonly<Record<string, { readonly default: TmvcViewFunction }>>;

/**
 * Configuration object accepted by bootstrap(). Outlet and configure are
 * required; viewsRoot, views, and onError are optional.
 */
export interface AppConfig {
  readonly outlet: Element;
  readonly configure: (app: AppBuilder) => void;
  readonly viewsRoot?: string;
  /**
   * View loader map from import.meta.glob('/views/**\/*.tmvc').
   * Required for production builds. In dev mode the framework falls back to
   * a bare dynamic import if this is omitted, but that path is not bundleable.
   */
  readonly views?: ViewGlob;
  /**
   * Eager partial map from import.meta.glob('/src/partials/**\/*.tmvc', { eager: true }).
   * Required to use context.partial() in view templates.
   */
  readonly partials?: PartialGlob;
  /**
   * Eager layout glob from import.meta.glob('/src/layouts/**\/*.tmvc', { eager: true }).
   * Bootstrap calls defineLayout() automatically for each file. Controllers
   * reference layouts by name string: @layout('AppLayout').
   */
  readonly layouts?: LayoutGlob;
  /**
   * Eager component glob from import.meta.glob('/src/components/**\/*.tmvc', { eager: true }).
   * Each file's default export becomes context[filename] in every view and partial.
   */
  readonly components?: ComponentGlob;
  readonly onError?: ErrorHandler;
  readonly logging?: {
    readonly level?: LogLevel;
    readonly provider?: LogProvider;
  };
}

// ---------------------------------------------------------------------------
// .tmvc file format types (Phase 2, §14)
// ---------------------------------------------------------------------------

/**
 * The function signature that every compiled or parsed .tmvc file produces.
 * The default export of a Vite-generated module satisfies this type.
 * The value returned by the runtime parser also satisfies this type.
 */
export type TmvcViewFunction = (context: ViewContext) => Fragment;

/**
 * Discriminated union for the forbidden or misplaced constructs in .tmvc markup
 * text. `line` is the 1-based line number in the .tmvc source. `source` is the
 * text of the offending line.
 */
export type TmvcValidationError =
  | { readonly kind: 'import-statement'; readonly line: number; readonly source: string }
  | { readonly kind: 'export-statement'; readonly line: number; readonly source: string }
  | { readonly kind: 'class-definition'; readonly line: number; readonly source: string }
  | { readonly kind: 'invalid-model-directive'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-in-view'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-import'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-export'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-async'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-fetch'; readonly line: number; readonly source: string };
