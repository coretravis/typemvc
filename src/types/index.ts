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

/**
 * The model a failure view receives as `context.model` when an action throws. It is
 * a deliberately narrow shape, never the raw `Error`: a development build surfaces
 * the message and name, and a production build shows a generic message, so a stack,
 * an internal URL, or a database message an exception carried never reaches the DOM.
 * Type a failure view's model with it: `IView<FailureModel>`.
 */
export interface FailureModel {
  readonly message: string;
  readonly name: string;
}

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
 * One field of a {@link Form}. `value` is the writable signal you bind to an
 * input; `error` is the eager validation message from the DTO's own decorators,
 * recomputed as the value (or a sibling's value, for a cross-field validator)
 * changes; `touched` flips to true the first time `onInput` fires, so a template
 * can hold a server-round-trip error until the field is edited. `onInput` reads
 * the event target, stores its raw value, and marks the field touched.
 */
export interface FormField<T> {
  readonly value: Signal<T>;
  readonly error: ReadonlySignal<string | null>;
  readonly touched: ReadonlySignal<boolean>;
  readonly onInput: (event: Event) => void;
}

/**
 * Eager, reactive form state produced by `useForm`. Each field validates against
 * the DTO's existing decorators as it changes, so a template can disable a submit
 * button through `invalid` and show messages before the form is ever submitted.
 * It owns field state and validation only, not submission: the form element still
 * posts to a `@post` action, which binds and validates the same DTO.
 */
export interface Form<T> {
  readonly fields: { readonly [K in keyof T]: FormField<T[K]> };
  readonly valid: ReadonlySignal<boolean>;
  readonly invalid: ReadonlySignal<boolean>;
  readonly errors: ReadonlySignal<Readonly<Record<string, string>>>;
  readonly values: ReadonlySignal<T>;
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
 * The callback form of the `ref` attribute. It receives the rendered element
 * once the fragment holding it is mounted, so measuring, focusing, and handing
 * the node to a third party widget all see a connected element. Returning a
 * function registers a teardown that runs when the fragment is disposed.
 *
 * Example:
 *   html`<input ref="${(el) => { el.focus(); }}" />`
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- the callback either returns a teardown or nothing
export type RefCallback<E extends Element = Element> = (element: E) => (() => void) | void;

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
 * 'app-stop': the application was stopped, tearing down every live controller.
 */
export type DisposeReason = 'ttl-expired' | 'navigation' | 'app-stop';

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
/** The stage of the navigation lifecycle a framework error was raised in. */
export type ErrorPhase = 'action' | 'lifecycle' | 'render' | 'guard' | 'startup';

/**
 * A structured framework error event. It carries the controller and action names,
 * the route being handled, and the phase the failure occurred in, so an
 * observability integration does not have to reconstruct that context from a bare
 * message. `error` is the underlying cause.
 */
export interface FrameworkErrorEvent {
  readonly error: Error;
  readonly controller: string | null;
  readonly action: string | null;
  readonly route: string | null;
  readonly phase: ErrorPhase;
}

/**
 * Application-level error handler registered at bootstrap. It receives the error and
 * the method name for backward compatibility, plus a structured
 * {@link FrameworkErrorEvent} as a third argument that a handler may read for the
 * full context. A handler that takes only the first two arguments is unaffected.
 */
export type ErrorHandler = (error: Error, methodName: string, event?: FrameworkErrorEvent) => void;

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
 * A service that starts with the application and outlives every route: a global
 * keyboard shortcut, theme persistence, a websocket connection, an analytics
 * listener, a poller. Register the service under a DI token as usual, then pass
 * that token to `app.onStart(token)`.
 *
 * Bootstrap resolves each registered token after the container is sealed and
 * before the first navigation, then calls `start()` on the resolved object.
 * Implementing this interface is optional: a service that does its work in its
 * constructor is started by the resolution alone.
 *
 * `start()` is not awaited before the first route renders, so it never delays the
 * first paint. Work the first route depends on belongs in a route guard, which
 * does await. A throw or a rejection is logged, handed to the application error
 * handler, and does not stop the remaining tasks or the first navigation.
 *
 * `stop()` runs when the application handle is stopped, which is what lets a test
 * start an app and release whatever it attached.
 *
 * @example
 * ```ts
 * class ShortcutService implements IStartupTask {
 *   readonly #onKeyDown = (e: KeyboardEvent): void => {
 *     if (e.key === 'k' && e.metaKey) this.router.navigateTo('/search');
 *   };
 *
 *   constructor(@inject(ROUTER) private readonly router: IRouter) {}
 *
 *   start(): void { document.addEventListener('keydown', this.#onKeyDown); }
 *   stop(): void { document.removeEventListener('keydown', this.#onKeyDown); }
 * }
 * ```
 */
export interface IStartupTask {
  /** Called once, after the container is sealed and before the first navigation. */
  start(): void | Promise<void>;
  /** Called once when the application handle is stopped. Release what start() attached. */
  stop?(): void | Promise<void>;
}

/**
 * The running application returned by {@link bootstrap}. An application entry
 * file can ignore it. A test uses `stop()` to tear the application down without
 * leaking the listeners, timers, sockets, controllers, and DOM it attached, so an
 * app can be started and fully released between cases.
 */
export interface AppHandle {
  /** The root DI container, sealed. Resolve a registered token to inspect it. */
  readonly container: Container;
  /**
   * Settles when the first navigation has finished: it resolves once the first
   * route has mounted, and it also resolves, after the failure has been reported
   * through the error chain, when the first route fails. Awaiting it is optional,
   * so an application that ignores it behaves exactly as one that does not; it
   * exists so a caller that needs the first view on screen (a test, a splash
   * screen) can wait for it without a first-navigation failure becoming an
   * unobserved rejection.
   */
  readonly ready: Promise<void>;
  /**
   * Stops the application and releases everything it attached. First it calls
   * `stop()` on every startup task that has one, in registration order, so a task
   * can release what it holds before the framework tears down under it; a task that
   * throws is logged and handed to the application error handler, and the remaining
   * tasks still stop. Then it detaches the navigation listener, disposes every live
   * controller through the router, disposes the mounted view fragment and its
   * effects, and removes the route announcer region. Calling this more than once is
   * a no-op.
   */
  stop(): Promise<void>;
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
  /**
   * Registers a startup task: bootstrap resolves `token` from the container after
   * the container is sealed and before the first navigation, and calls `start()`
   * on the resolved object if it has one. Tasks run in registration order.
   * Registering the same token twice starts it once.
   *
   * This is the home for work that starts with the application and belongs to no
   * route. If the entry file holds a concern that is not a registration, that
   * concern wants a startup task.
   */
  onStart(token: symbol): AppBuilder;
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
 * `parent` is the named export a layout file's `@parent` directive compiles to:
 * the name of the layout that wraps this one. Bootstrap resolves it against the
 * same map, after every layout in the glob has been created.
 *
 * Example (in main.ts):
 *   const layouts = import.meta.glob('/src/layouts/**\/*.tmvc', { eager: true }) as LayoutGlob;
 *   bootstrap({ outlet, views, layouts, configure(app) { ... } });
 *
 * Controllers reference layouts by filename (without extension):
 *   @layout('AppLayout')
 */
export type LayoutGlob = Readonly<
  Record<string, { readonly default: TmvcViewFunction; readonly parent?: string }>
>;

/**
 * Whether a navigation mounts its view inside a View Transitions cross fade.
 *
 * - `'auto'` (the default): use a transition, unless the user has asked their
 *   operating system for reduced motion.
 * - `'on'`: always use a transition, including for a user who has asked for
 *   reduced motion.
 * - `'off'`: never; mount the view directly.
 *
 * The reduced motion setting is read on every navigation, so a user who changes
 * it mid session is respected from the next navigation onwards. A browser with no
 * View Transitions API mounts directly under every setting.
 */
export type TransitionMode = 'auto' | 'on' | 'off';

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
  /**
   * The application's page title, in one of two forms.
   *
   * A string is the default title: it is used when a route supplies none of its
   * own, through a `@title` decorator or a `this.title` assignment in the action.
   *
   * A function is a template: it wraps whatever title the route resolved, so a
   * suffix is written once rather than on every route. It is not called when no
   * route title was resolved, and a template that throws is logged and leaves the
   * title unchanged rather than failing the navigation.
   *
   * @example
   * ```ts
   * bootstrap({ outlet, title: 'Acme', configure });                  // default
   * bootstrap({ outlet, title: (page) => `${page} | Acme`, configure }); // template
   * ```
   */
  readonly title?: string | ((page: string) => string);
  /**
   * How a navigation mounts its view. Default: 'auto', which uses a view
   * transition unless the user has asked for reduced motion.
   *
   * Style the transition with the ::view-transition-old(root) and
   * ::view-transition-new(root) pseudo elements.
   */
  readonly transitions?: TransitionMode;
  /**
   * The application default pending view, shown while an async action awaits when
   * the route declares no `@pending` of its own. A path relative to the views root,
   * without extension. Set it once here rather than decorating every route.
   */
  readonly pendingView?: string;
  /**
   * The application default failure view, shown when an action throws and the route
   * declares no `@failure` of its own. A path relative to the views root, without
   * extension. With none set, an action failure clears the outlet as before.
   */
  readonly failureView?: string;
  /**
   * How long an async action may run before its pending view is shown, in
   * milliseconds. Default: 120. Below this, a fast action settles first and never
   * flashes a skeleton; above it, a slow route paints one promptly.
   */
  readonly pendingDelay?: number;
  /**
   * Whether the framework names each completed navigation in a polite live region,
   * so a screen reader announces the new page. Default: true.
   *
   * A client side navigation replaces the outlet without the page load a screen
   * reader would otherwise announce, and only the router knows the route changed.
   * Set this to false only to announce navigations yourself.
   */
  readonly announce?: boolean;
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
  | { readonly kind: 'invalid-use-directive'; readonly line: number; readonly source: string }
  | { readonly kind: 'invalid-parent-directive'; readonly line: number; readonly source: string }
  | { readonly kind: 'parent-outside-layout'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-in-view'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-import'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-export'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-async'; readonly line: number; readonly source: string }
  | { readonly kind: 'local-fetch'; readonly line: number; readonly source: string };
