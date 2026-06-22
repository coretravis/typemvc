/**
 * First-party testing helpers for TypeMVC applications (issue 051, phase 1).
 *
 * These are headless, DOM-free helpers for unit-testing the parts of a TypeMVC
 * app that hold behavior: controllers, dependency injection, form binding and
 * validation, route guards, reactivity, and action results. They run under the
 * default `node` test environment and work with any runner. Import the optional
 * `@typemvc/core/testing/vitest` entry to register matchers like `toBeView`.
 *
 * View rendering and router-based navigation simulation are phase 2
 * (`@typemvc/core/testing` DOM helpers, issue 052) and require a DOM environment.
 */

import { Container } from '../di/container.js';
import { getInjectTokens } from '../di/decorators.js';
import { getBodyMeta } from '../core/decorators.js';
import { Controller } from '../core/controller.js';
import { bindFormData } from '../validation/binder.js';
import type { DtoBindingResult } from '../validation/binder.js';
import { flush } from '../reactivity/scheduler.js';
import { Router } from '../router/router.js';
import type { RouterDispatchInfo } from '../router/router.js';
import { installNavigationRecorder } from './navigation.js';
import type { Fragment } from '../renderer/fragment.js';
import type {
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
  const tokens = getInjectTokens(Ctor);
  const deps = tokens.map((token, i) => {
    if (token === undefined) {
      throw new Error(
        `[TypeMVC] "${Ctor.name}" constructor parameter at index ${String(i)} ` +
          `has no @inject decorator. All injected parameters must be decorated with @inject.`,
      );
    }
    return container.resolve(token);
  });
  return new Ctor(...deps);
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
  #instance: C | undefined;

  constructor(Ctor: AnyCtor<C>) {
    this.#Ctor = Ctor;
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
    this.#instance ??= instantiate(this.#container, this.#Ctor);
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

  constructor(Ctor: AnyCtor<C>, action: string, record: FormRecord) {
    this.#Ctor = Ctor;
    this.#action = action;
    this.#record = record;
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

/** Synchronously flushes pending reactive effects so assertions see updates. */
export function flushEffects(): void {
  flush();
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
// Route simulation (issue 052): drive the real router headlessly
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
  /** Field errors accumulated on the controller (binding + addError). */
  readonly errors: Readonly<Record<string, string>>;
}

function toUrl(path: string): string {
  return new URL(path, 'http://localhost').href;
}

/** Fluent test application returned by {@link createTestApp}. */
export class TestApp {
  readonly #container = new Container();
  readonly #controllers: AnyCtor<Controller>[] = [];

  /** Registers a controller's routes with the app. */
  route(Ctor: AnyCtor<Controller>): this {
    this.#controllers.push(Ctor);
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
    const captured: { info: RouterDispatchInfo | null; notFound: boolean } = {
      info: null,
      notFound: false,
    };

    const fakeOutlet = { replaceChildren: () => undefined } as unknown as Element;
    const router = new Router(this.#container, fakeOutlet, {
      onDispatch: (info) => { captured.info = info; },
      onNotFound: () => { captured.notFound = true; },
    });
    for (const Ctor of this.#controllers) {
      router.registerController(Ctor);
    }

    const recorder = installNavigationRecorder();
    try {
      await router.handle(toUrl(path), formData);
      flush();
    } finally {
      recorder.restore();
    }

    const info = captured.info;
    const lastRedirect = recorder.calls.length > 0 ? recorder.calls[recorder.calls.length - 1] : undefined;

    return {
      controller: info?.controller ?? null,
      action: info?.action ?? null,
      params: info?.params ?? {},
      query: info?.query ?? new URLSearchParams(),
      view: info?.result ?? null,
      redirectedTo: lastRedirect?.path ?? null,
      redirectReplace: lastRedirect?.replace ?? false,
      cancelled: info?.cancelled ?? false,
      notFound: captured.notFound,
      errors: info?.controller != null ? Object.fromEntries(info.controller._getFieldErrors()) : {},
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
// DOM rendering (issue 052): requires a DOM test environment
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
      "[TypeMVC] renderView/renderTemplate require a DOM environment. Add " +
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
  for (const node of fn().nodes) container.appendChild(node);
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
