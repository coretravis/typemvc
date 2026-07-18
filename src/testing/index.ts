/**
 * First-party testing helpers for TypeMVC applications.
 *
 * The headless helpers unit-test the parts of an app that hold behavior:
 * controllers, dependency injection, form binding and validation, route guards,
 * reactivity, action results, and whole navigations. They run under the default
 * `node` test environment and work with any runner. Import the optional
 * `@typemvc/core/testing/vitest` entry to register matchers like `toBeView`.
 *
 * The rendering helpers (`renderComponent`, `renderView`, `renderTemplate`) mount
 * into a real DOM and require a DOM test environment such as happy-dom or jsdom.
 */

import { Container } from '../di/container.js';
import { resolveInjectedArgs } from '../di/injector.js';
import { getBodyMeta } from '../core/decorators.js';
import { Controller } from '../core/controller.js';
import { ROUTER } from '../router/tokens.js';
import { bindFormData } from '../validation/binder.js';
import type { DtoBindingResult } from '../validation/binder.js';
import { flush, drain } from '../reactivity/scheduler.js';
import { Router } from '../router/router.js';
import type { RouterDispatchInfo, FailureInfo } from '../router/router.js';
import { installNavigationRecorder } from './navigation.js';
import {
  _getComponentRegistry,
  _invokeComponent,
  _setComponentRegistry,
} from '../core/component-registry.js';
import type { Fragment } from '../renderer/fragment.js';
import type {
  ComponentFunction,
  IView,
  ResolvedRoute,
  IRouteGuard,
  TmvcViewFunction,
  ViewContext,
  IRouter,
} from '../types/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any[] is required: unknown[] rejects constructors with typed (injected) parameters, matching the framework's AnyConstructor pattern
type AnyCtor<T> = new (...args: any[]) => T;

/** A DTO class with a parameterless constructor (the @body / bindForm target). */
type DtoConstructor = new () => object;

/** A plain record of form fields; array values become repeated FormData entries. */
export type FormRecord = Readonly<Record<string, string | readonly string[]>>;

/** The inspectable outcome of invoking a controller action in a test. */
export interface ControllerTestResult<C, R> {
  /** The value the action returned (typically an IView). */
  readonly result: R;
  /** The controller instance the action ran on. */
  readonly controller: C;
  /** The ViewBag contents (controller.data) after the action ran. */
  readonly viewBag: Readonly<Record<string, unknown>>;
  /** Field errors accumulated on the controller (binding + addError). */
  readonly errors: Readonly<Record<string, string>>;
  /** True when the controller has any field error. */
  readonly hasErrors: boolean;
}

// ---------------------------------------------------------------------------
// Internal: DI instantiation (mirrors the router's resolve-then-construct path)
// ---------------------------------------------------------------------------

function instantiate<T>(container: Container, Ctor: AnyCtor<T>): T {
  const deps = resolveInjectedArgs(container, Ctor, 'Class');
  return new Ctor(...deps);
}

// ---------------------------------------------------------------------------
// Internal: a router that records navigations instead of performing them
// ---------------------------------------------------------------------------

/** A navigation recorded by a {@link TestRouter}. `path` is null for back/forward. */
export interface RecordedRouterCall {
  readonly method: 'navigateTo' | 'replace' | 'back' | 'forward';
  readonly path: string | null;
}

/** An {@link IRouter} that records navigations rather than performing them. */
export interface TestRouter extends IRouter {
  readonly calls: readonly RecordedRouterCall[];
}

/**
 * Creates a router for tests. It records every navigation on `calls` and performs
 * none of them, so a controller's `this.router.navigateTo('/x')` is assertable
 * without a Navigation API.
 */
export function createTestRouter(current = '/'): TestRouter {
  const calls: RecordedRouterCall[] = [];
  return {
    calls,
    current,
    navigateTo: (path: string): void => { calls.push({ method: 'navigateTo', path }); },
    replace: (path: string): void => { calls.push({ method: 'replace', path }); },
    back: (): void => { calls.push({ method: 'back', path: null }); },
    forward: (): void => { calls.push({ method: 'forward', path: null }); },
  };
}

function controllerState(controller: Controller): {
  viewBag: Readonly<Record<string, unknown>>;
  errors: Readonly<Record<string, string>>;
  hasErrors: boolean;
} {
  return {
    viewBag: controller._getViewBag().getAll(),
    errors: Object.fromEntries(controller._getFieldErrors()),
    hasErrors: controller.hasErrors(),
  };
}

// ---------------------------------------------------------------------------
// Controller testing
// ---------------------------------------------------------------------------

/** Fluent harness returned by {@link createControllerTest}. */
export class ControllerTest<C extends Controller> {
  readonly #container = new Container();
  readonly #Ctor: AnyCtor<C>;
  readonly #router = createTestRouter();
  readonly #abort = new AbortController();
  #instance: C | undefined;

  constructor(Ctor: AnyCtor<C>) {
    this.#Ctor = Ctor;
    this.#container.singleton(ROUTER, () => this.#router);
  }

  /** The recording router the controller under test navigates through. */
  get router(): TestRouter {
    return this.#router;
  }

  /** The abort signal handed to the controller, the one `this.signal` reads. */
  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  /**
   * Aborts the controller's signal, as navigating away mid flight does. A `fetch`
   * bound to `this.signal` rejects with an `AbortError`, so an action's cancellation
   * path can be driven and asserted.
   */
  abort(): void {
    this.#abort.abort();
  }

  /** Registers a dependency value (resolved as a singleton) for a DI token. */
  mock(token: symbol, impl: unknown): this {
    this.#container.singleton(token, () => impl);
    return this;
  }

  /** Registers a dependency factory for a DI token. */
  provide(token: symbol, factory: (c: Container) => unknown): this {
    this.#container.singleton(token, factory);
    return this;
  }

  /** The underlying DI container (for advanced assertions). */
  get container(): Container {
    return this.#container;
  }

  /** Builds (once) and returns the controller instance with mocks injected. */
  build(): C {
    if (this.#instance === undefined) {
      const instance = instantiate(this.#container, this.#Ctor);
      instance._setRouter(this.#router);
      instance._setSignal(this.#abort.signal);
      this.#instance = instance;
    }
    return this.#instance;
  }

  /** Invokes an action and returns the result plus the controller's state. */
  async action<R>(fn: (controller: C) => R | Promise<R>): Promise<ControllerTestResult<C, Awaited<R>>> {
    const controller = this.build();
    const result = await fn(controller);
    return { result, controller, ...controllerState(controller) };
  }
}

/**
 * Creates a controller test harness: register fake dependencies with `.mock()`,
 * then invoke an action with `.action()`.
 *
 * @example
 * ```ts
 * const t = createControllerTest(UsersController).mock(USER_SERVICE, fakeUsers);
 * const { result, viewBag } = await t.action((c) => c.index());
 * expect(result).toBeView('users/index');
 * ```
 */
export function createControllerTest<C extends Controller>(Ctor: AnyCtor<C>): ControllerTest<C> {
  return new ControllerTest(Ctor);
}

// ---------------------------------------------------------------------------
// Form submission (headless: binds the @body DTO and invokes the action)
// ---------------------------------------------------------------------------

/** Fluent harness returned by {@link submitForm}. */
export class FormSubmission<C extends Controller> {
  readonly #container = new Container();
  readonly #Ctor: AnyCtor<C>;
  readonly #action: string;
  readonly #record: FormRecord;
  readonly #router = createTestRouter();

  constructor(Ctor: AnyCtor<C>, action: string, record: FormRecord) {
    this.#Ctor = Ctor;
    this.#action = action;
    this.#record = record;
    this.#container.singleton(ROUTER, () => this.#router);
  }

  /** The recording router the controller under test navigates through. */
  get router(): TestRouter {
    return this.#router;
  }

  mock(token: symbol, impl: unknown): this {
    this.#container.singleton(token, () => impl);
    return this;
  }

  provide(token: symbol, factory: (c: Container) => unknown): this {
    this.#container.singleton(token, factory);
    return this;
  }

  /** Binds the record to the action's @body DTO, primes errors, and runs it. */
  async run(): Promise<ControllerTestResult<C, IView>> {
    const meta = getBodyMeta(this.#Ctor.prototype as object, this.#action);
    if (meta === undefined) {
      throw new Error(
        `[TypeMVC] submitForm(): action "${this.#action}" on "${this.#Ctor.name}" has no ` +
          `@body parameter. Add @body(Dto) to the action, or use createControllerTest().action().`,
      );
    }

    const controller = instantiate(this.#container, this.#Ctor);
    controller._setRouter(this.#router);
    controller._setSignal(new AbortController().signal);
    const { instance, fieldErrors } = bindFormData(meta.dto, createFormData(this.#record));
    controller._primeErrors(fieldErrors);

    const args: unknown[] = [];
    args[meta.index] = instance;

    const fn = (controller as unknown as Record<string, unknown>)[this.#action];
    if (typeof fn !== 'function') {
      throw new Error(`[TypeMVC] submitForm(): "${this.#action}" is not a method on "${this.#Ctor.name}".`);
    }

    const result = (await Promise.resolve(
      (fn as (...a: unknown[]) => unknown).apply(controller, args),
    )) as IView;

    return { result, controller, ...controllerState(controller) };
  }
}

/**
 * Submits a form record to a controller action's `@body` DTO without a router:
 * binds and validates the record, primes `context.errors`, and invokes the
 * action. Use for testing POST/validation workflows headlessly.
 *
 * @example
 * ```ts
 * const { result, errors } = await submitForm(UsersController, 'create', {
 *   name: '', emailAddress: 'nope',
 * }).mock(USER_SERVICE, fakeUsers).run();
 * expect(errors.name).toBe('This field is required.');
 * ```
 */
export function submitForm<C extends Controller>(
  Ctor: AnyCtor<C>,
  action: string,
  record: FormRecord,
): FormSubmission<C> {
  return new FormSubmission(Ctor, action, record);
}

// ---------------------------------------------------------------------------
// Form data and binding utilities
// ---------------------------------------------------------------------------

/** Builds a FormData from a plain record; array values append repeated entries. */
export function createFormData(record: FormRecord): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const item of value as readonly string[]) formData.append(key, item);
    } else {
      formData.append(key, value as string);
    }
  }
  return formData;
}

/** Binds a record to a DTO class, returning the instance and any field errors. */
export function bindForm(DtoClass: DtoConstructor, record: FormRecord): DtoBindingResult {
  return bindFormData(DtoClass, createFormData(record));
}

// ---------------------------------------------------------------------------
// Guard testing
// ---------------------------------------------------------------------------

/** Fluent harness returned by {@link testGuard}. */
export class GuardTest {
  readonly #container = new Container();
  readonly #Ctor: AnyCtor<IRouteGuard>;

  constructor(Ctor: AnyCtor<IRouteGuard>) {
    this.#Ctor = Ctor;
  }

  mock(token: symbol, impl: unknown): this {
    this.#container.singleton(token, () => impl);
    return this;
  }

  provide(token: symbol, factory: (c: Container) => unknown): this {
    this.#container.singleton(token, factory);
    return this;
  }

  /** Resolves the guard from the container and evaluates it against a route. */
  canActivate(route: ResolvedRoute): boolean | Promise<boolean> {
    const guard = instantiate(this.#container, this.#Ctor);
    return guard.canActivate(route);
  }
}

/**
 * Creates a guard test harness: register fake dependencies with `.mock()`, then
 * evaluate the guard with `.canActivate(createRoute('/path'))`.
 */
export function testGuard(Ctor: AnyCtor<IRouteGuard>): GuardTest {
  return new GuardTest(Ctor);
}

/**
 * Builds a {@link ResolvedRoute} for guard and unit tests. Query in the path or
 * in `opts.query` are merged; `opts.params` supplies named route segments.
 */
export function createRoute(
  path: string,
  opts?: { readonly params?: Readonly<Record<string, string>>; readonly query?: Readonly<Record<string, string>> },
): ResolvedRoute {
  const queryIdx = path.indexOf('?');
  const pathname = queryIdx === -1 ? path : path.slice(0, queryIdx);
  const query = new URLSearchParams(queryIdx === -1 ? '' : path.slice(queryIdx + 1));
  if (opts?.query !== undefined) {
    for (const [key, value] of Object.entries(opts.query)) query.set(key, value);
  }
  return { pathname, params: opts?.params ?? {}, query };
}

// ---------------------------------------------------------------------------
// Reactivity
// ---------------------------------------------------------------------------

/**
 * Synchronously runs pending reactive effects so assertions see updates. Drains to
 * quiescence: an effect that wakes another effect settles in a single call, rather
 * than leaving the cascade for a later microtask.
 */
export function flushEffects(): void {
  drain();
}

// ---------------------------------------------------------------------------
// IView result predicates
// ---------------------------------------------------------------------------

/** True when the result is a view (optionally at `path`). */
export function isView(result: IView, path?: string): boolean {
  return result.kind === 'view' && (path === undefined || result.path === path);
}

/** True when the result is a partial view (optionally at `path`). */
export function isPartialView(result: IView, path?: string): boolean {
  return result.kind === 'partial' && (path === undefined || result.path === path);
}

/** True when the result is a (push) redirect (optionally to `path`). */
export function isRedirect(result: IView, path?: string): boolean {
  return result.kind === 'redirect' && (path === undefined || result.path === path);
}

/** True when the result is a replacing redirect (optionally to `path`). */
export function isRedirectReplace(result: IView, path?: string): boolean {
  return result.kind === 'redirect-replace' && (path === undefined || result.path === path);
}

/** True when the result is the empty view. */
export function isEmpty(result: IView): boolean {
  return result.kind === 'empty';
}

// ---------------------------------------------------------------------------
// Route simulation: drive the real router headlessly
// ---------------------------------------------------------------------------

/** The inspectable outcome of a simulated navigation. */
export interface NavigationResult {
  /** The matched controller instance, or null when cancelled or not found. */
  readonly controller: Controller | null;
  /** The matched action method name, or null when not found. */
  readonly action: string | null;
  /** Route segment parameters. */
  readonly params: Readonly<Record<string, string>>;
  /** Parsed query string. */
  readonly query: URLSearchParams;
  /** The action's IView result, or null when cancelled or not found. */
  readonly view: IView | null;
  /** The redirect target when the action redirected, else null. */
  readonly redirectedTo: string | null;
  /** True when the redirect replaced the history entry. */
  readonly redirectReplace: boolean;
  /** True when a guard denied the navigation. */
  readonly cancelled: boolean;
  /** True when no route matched the path. */
  readonly notFound: boolean;
  /** The pending view shown while an async action awaited, or null when none was. */
  readonly pending: IView | null;
  /** True when the action threw or rejected (an abort is not a failure). */
  readonly failed: boolean;
  /** The action's error when it failed, else null. */
  readonly error: Error | null;
  /** The failure view that claimed the outlet, or null when none resolved. */
  readonly failureView: IView | null;
  /** Field errors accumulated on the controller (binding + addError). */
  readonly errors: Readonly<Record<string, string>>;
  /**
   * The page title the navigation resolved, already wrapped by any application
   * template, or null when the route resolved none. A result that renders no view
   * resolves no title.
   */
  readonly title: string | null;
}

function toUrl(path: string): string {
  return new URL(path, 'http://localhost').href;
}

/** Fluent test application returned by {@link createTestApp}. */
export class TestApp {
  readonly #container = new Container();
  readonly #controllers: AnyCtor<Controller>[] = [];
  #router: Router | null = null;
  #pendingDelay: number | undefined;

  constructor() {
    // Transient, not singleton: a fresh Router is built for each navigation, and a
    // cached singleton would hand a later navigation the first one.
    this.#container.transient(ROUTER, (): IRouter => {
      const router = this.#router;
      if (router === null) {
        throw new Error(
          '[TypeMVC] The router is only available while a navigation is running. ' +
            'Resolve ROUTER from inside a controller, a guard, or a service the ' +
            'navigation reaches.',
        );
      }
      return router;
    });
  }

  /** Registers a controller's routes with the app. */
  route(Ctor: AnyCtor<Controller>): this {
    this.#controllers.push(Ctor);
    return this;
  }

  /**
   * Sets the delay before an async action's pending view is shown, in milliseconds.
   * Set it to 0 to drive a pending state deterministically: an action that yields to
   * a macrotask then shows its pending view, while one that resolves on a microtask
   * still settles first and shows none.
   */
  pendingDelay(ms: number): this {
    this.#pendingDelay = ms;
    return this;
  }

  mock(token: symbol, impl: unknown): this {
    this.#container.singleton(token, () => impl);
    return this;
  }

  provide(token: symbol, factory: (c: Container) => unknown): this {
    this.#container.singleton(token, factory);
    return this;
  }

  /** The underlying DI container (for advanced assertions). */
  get container(): Container {
    return this.#container;
  }

  /** Simulates a GET navigation to `path`. */
  async navigate(path: string): Promise<NavigationResult> {
    return this.#dispatch(path, null);
  }

  /** Simulates a POST submission of `form` to `path`. */
  async submit(path: string, opts: { readonly form: FormRecord }): Promise<NavigationResult> {
    return this.#dispatch(path, createFormData(opts.form));
  }

  async #dispatch(path: string, formData: FormData | null): Promise<NavigationResult> {
    // A holder object so the captured values keep their declared types (a
    // closure-assigned `let` would be narrowed away by control-flow analysis).
    const captured: {
      info: RouterDispatchInfo | null;
      notFound: boolean;
      pending: IView | null;
      failure: FailureInfo | null;
    } = {
      info: null,
      notFound: false,
      pending: null,
      failure: null,
    };

    const fakeOutlet = { replaceChildren: () => undefined } as unknown as Element;
    const router = new Router(this.#container, fakeOutlet, {
      onDispatch: (info) => { captured.info = info; },
      onNotFound: () => { captured.notFound = true; },
      onPending: (view) => { captured.pending = view; },
      onFailure: (info) => { captured.failure = info; },
      ...(this.#pendingDelay !== undefined ? { pendingDelay: this.#pendingDelay } : {}),
    });
    this.#router = router;
    for (const Ctor of this.#controllers) {
      router.registerController(Ctor);
    }

    const recorder = installNavigationRecorder();
    try {
      await router.handle(toUrl(path), formData);
      flush();
    } finally {
      recorder.restore();
      this.#router = null;
    }

    const info = captured.info;
    const failure = captured.failure;
    const controller = info?.controller ?? failure?.controller ?? null;
    const lastRedirect = recorder.calls.length > 0 ? recorder.calls[recorder.calls.length - 1] : undefined;

    return {
      controller,
      action: info?.action ?? failure?.action ?? null,
      params: info?.params ?? {},
      query: info?.query ?? new URLSearchParams(),
      view: info?.result ?? null,
      redirectedTo: lastRedirect?.path ?? null,
      redirectReplace: lastRedirect?.replace ?? false,
      cancelled: info?.cancelled ?? false,
      notFound: captured.notFound,
      pending: captured.pending,
      failed: failure !== null,
      error: failure?.error ?? null,
      failureView: failure?.view ?? null,
      errors: controller != null ? Object.fromEntries(controller._getFieldErrors()) : {},
      title: info?.title ?? null,
    };
  }
}

/**
 * Creates a test application that drives the real router headlessly. Register
 * controllers with `.route()` and dependencies with `.mock()`, then simulate a
 * navigation. The result exposes the matched controller, action, params, the
 * IView result, redirects, and guard cancellation. It does not mount the view
 * into a DOM (use {@link renderView} / {@link renderTemplate} for that).
 *
 * @example
 * ```ts
 * const app = createTestApp().route(UsersController).mock(USER_SERVICE, fakeUsers);
 * const r = await app.navigate('/users/42');
 * expect(r.controller).toBeInstanceOf(UsersController);
 * expect(r.action).toBe('details');
 * ```
 */
export function createTestApp(): TestApp {
  return new TestApp();
}

/** Drains pending reactive effects so post-navigation assertions are stable. */
export async function flushNavigation(): Promise<void> {
  flush();
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

// ---------------------------------------------------------------------------
// DOM rendering: requires a DOM test environment
// ---------------------------------------------------------------------------

/** A rendered fragment with DOM query and interaction helpers. */
export interface RenderedView {
  text(): string;
  html(): string;
  query(selector: string): Element | null;
  queryAll(selector: string): Element[];
  click(selector: string): void;
  input(selector: string, value: string): void;
  submit(selector: string): void;
}

function requireDom(): void {
  if (typeof document === 'undefined') {
    throw new Error(
      "[TypeMVC] renderComponent/renderView/renderTemplate require a DOM environment. Add " +
        "'// @vitest-environment happy-dom' to the test file (or configure jsdom).",
    );
  }
}

function requireEl(container: Element, selector: string): Element {
  const el = container.querySelector(selector);
  if (el === null) {
    throw new Error(`[TypeMVC] No element matched selector "${selector}" in the rendered view.`);
  }
  return el;
}

function makeRenderedView(container: Element): RenderedView {
  return {
    text: () => container.textContent,
    html: () => container.innerHTML,
    query: (selector) => container.querySelector(selector),
    queryAll: (selector) => Array.from(container.querySelectorAll(selector)),
    click: (selector) => {
      requireEl(container, selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
    input: (selector, value) => {
      const el = requireEl(container, selector) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    submit: (selector) => {
      requireEl(container, selector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    },
  };
}

const stubRouter: IRouter = {
  navigateTo: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  current: '/',
};

/**
 * Builds a minimal {@link ViewContext} for rendering a view in isolation. Pass a
 * partial to override `model`, `data`, `params`, `query`, or other fields.
 */
export function createTestContext(partial?: Partial<ViewContext>): ViewContext {
  const base = {
    model: {},
    data: {},
    errors: { action: null },
    router: stubRouter,
    params: {},
    query: new URLSearchParams(),
    partial: (): never => {
      throw new Error('[TypeMVC] context.partial() is not configured in this test context.');
    },
  };
  return { ...base, ...partial };
}

/** Renders an inline `html` template into a detached DOM node for assertions. */
export function renderTemplate(fn: () => Fragment): RenderedView {
  requireDom();
  const container = document.createElement('div');
  const fragment = fn();
  for (const node of fragment.nodes) container.appendChild(node);
  fragment.mount();
  return makeRenderedView(container);
}

/**
 * Renders a compiled view function with a test context into a detached DOM node.
 *
 * @param viewFn - A compiled view function (the default export of a `.tmvc`
 *   module, or one produced by the runtime parser).
 * @param context - An optional partial view context (model, data, params, ...).
 */
export function renderView(viewFn: TmvcViewFunction, context?: Partial<ViewContext>): RenderedView {
  requireDom();
  const ctx = createTestContext(context);
  return renderTemplate(() => viewFn(ctx));
}

// ---------------------------------------------------------------------------
// Component rendering (DOM required)
// ---------------------------------------------------------------------------

/** A mounted component: the {@link RenderedView} surface plus a container and teardown. */
export interface RenderedComponent extends RenderedView {
  /** The element holding the component's rendered nodes. */
  readonly container: Element;
  /**
   * Disposes the component (its effects and `onCleanup` callbacks) and empties
   * the container, exactly as removing it from the page does.
   */
  unmount(): void;
}

/** Options accepted by {@link renderComponent}. */
export interface RenderComponentOptions {
  /**
   * Components the template under test renders as tags, keyed by tag name. They
   * are registered for this render only and the previous registry is restored on
   * `unmount()`, so no registration leaks into the next test.
   */
  readonly components?: Readonly<Record<string, ComponentFunction>>;
}

function emptyComponentMap(): Record<string, ComponentFunction> {
  return Object.create(null) as Record<string, ComponentFunction>;
}

/**
 * Registers components by tag name so a component or view under test can render
 * nested component tags. Outside a test, `bootstrap()` populates this registry
 * from the components glob; a unit test has no bootstrap, so an unregistered tag
 * renders nothing and warns.
 *
 * The registry is module level state. Call {@link resetComponents} in an
 * `afterEach`, or pass `components` to {@link renderComponent} to scope the
 * registration to a single render.
 *
 * @param map - Components keyed by the tag name their template uses.
 * @example
 * ```ts
 * afterEach(resetComponents);
 *
 * registerComponents({ Pill });
 * const { queryAll } = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });
 * expect(queryAll('.pill')).toHaveLength(1);
 * ```
 */
export function registerComponents(map: Readonly<Record<string, ComponentFunction>>): void {
  const merged = emptyComponentMap();
  Object.assign(merged, _getComponentRegistry(), map);
  _setComponentRegistry(merged);
}

/** Clears every component registered with {@link registerComponents}. */
export function resetComponents(): void {
  _setComponentRegistry(emptyComponentMap());
}

/**
 * Mounts a component into a container and returns the same assertion and
 * interaction surface as {@link renderView}, plus `unmount()`.
 *
 * The component runs through the framework's owner scope, so its `@local`
 * effects, `onCleanup` callbacks and `ref` callbacks behave as they do in the
 * browser: refs receive a connected element, and `unmount()` disposes everything
 * the render registered.
 *
 * @param component - The component function (the default export of a `.tmvc`
 *   component module).
 * @param props - The props object, passed to the component as given.
 * @param options - Optional per-render component registrations.
 * @example
 * ```ts
 * const { query, click, unmount } = renderComponent(Counter, { label: 'Hits', step: 2 });
 * expect(query('.counter__value')).toHaveText('0');
 *
 * click('button');
 * flushEffects();
 * expect(query('.counter__value')).toHaveText('2');
 *
 * unmount();
 * ```
 */
export function renderComponent<P extends object = Record<string, unknown>>(
  component: (props: P) => Fragment,
  props?: P,
  options?: RenderComponentOptions,
): RenderedComponent {
  requireDom();

  const scoped = options?.components;
  const previousRegistry = scoped === undefined ? null : _getComponentRegistry();
  if (scoped !== undefined) registerComponents(scoped);

  const restoreRegistry = (): void => {
    if (previousRegistry !== null) _setComponentRegistry(previousRegistry);
  };

  // The container is in the document, not detached: a mounted fragment fires its
  // ref callbacks, and a ref that measures or focuses needs a connected element.
  const container = document.createElement('div');
  document.body.appendChild(container);

  let fragment: Fragment;
  try {
    fragment = _invokeComponent(component, props ?? (Object.create(null) as Record<string, unknown>));
  } catch (err) {
    container.remove();
    restoreRegistry();
    throw err;
  }

  for (const node of fragment.nodes) container.appendChild(node);
  fragment.mount();

  let unmounted = false;
  return {
    ...makeRenderedView(container),
    container,
    unmount: (): void => {
      if (unmounted) return;
      unmounted = true;
      fragment.dispose();
      container.replaceChildren();
      container.remove();
      restoreRegistry();
    },
  };
}
