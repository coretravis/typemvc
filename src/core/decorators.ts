import type {
  ActionMeta,
  ControllerMeta,
  GuardConstructor,
  LayoutConstructor,
  RetentionMeta,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Internal constructor type (avoids the banned `Function` type)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any[] is required: unknown[] rejects typed constructor params, breaking @inject usage on controllers
type AnyConstructor = new (...args: any[]) => unknown;

// ---------------------------------------------------------------------------
// Reserved context keys (checked at @controller decoration time)
// ---------------------------------------------------------------------------

export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'data',
  'errors',
  'router',
  'params',
  'query',
  'partial',
  'auth',
  'model',
]);

// ---------------------------------------------------------------------------
// Metadata stores (module-level WeakMaps, keyed on class or prototype)
// ---------------------------------------------------------------------------

const controllerMetaStore = new WeakMap<AnyConstructor, ControllerMeta>();
const retentionMetaStore = new WeakMap<AnyConstructor, RetentionMeta>();
const actionMetaStore = new WeakMap<object, Map<string, ActionMeta>>();
const classGuardStore = new WeakMap<AnyConstructor, GuardConstructor[]>();
const methodGuardStore = new WeakMap<object, Map<string, GuardConstructor[]>>();
const classLayoutStore = new WeakMap<AnyConstructor, LayoutConstructor | string>();
const methodLayoutStore = new WeakMap<object, Map<string, LayoutConstructor | string>>();
const bodyMetaStore = new WeakMap<object, Map<string, BodyMeta>>();

// ---------------------------------------------------------------------------
// Route registry (populated by @controller; read by the router)
// ---------------------------------------------------------------------------

const _routeRegistry = new Set<AnyConstructor>();
export const routeRegistry: ReadonlySet<AnyConstructor> = _routeRegistry;

// ---------------------------------------------------------------------------
// Dual-use decorator type for @guard and @layout
// ---------------------------------------------------------------------------

type ClassDec = (target: AnyConstructor) => void;
type MethodDec = (target: object, key: string | symbol, desc: PropertyDescriptor) => void;
type DualDecorator = ClassDec & MethodDec;

// ---------------------------------------------------------------------------
// @body parameter binding metadata
// ---------------------------------------------------------------------------

/** A DTO class with a parameterless constructor, bound to a request body. */
type DtoConstructor = new () => object;

/** Records which action parameter receives the bound request body, and the DTO class. */
export interface BodyMeta {
  readonly index: number;
  readonly dto: DtoConstructor;
}

// ---------------------------------------------------------------------------
// @controller(basePath)
// ---------------------------------------------------------------------------

/**
 * Registers a class as a routed controller and sets its base path. Every verb
 * decorator (`@get`, `@post`, ...) on the class maps relative to this path.
 * A controller must be passed to `app.route()` in the bootstrap configure
 * callback to be discoverable.
 *
 * @param basePath - The base URL path for all actions on this controller.
 * @example
 * ```ts
 * @controller('/todos')
 * class TodoController extends Controller {
 *   @get() index(): IView { return View(); }
 *   @get('{id}') detail(id: string): IView { return View(); }
 * }
 * ```
 */
export function controller(basePath: string): (target: AnyConstructor) => void {
  return function (target: AnyConstructor): void {
    const proto = target.prototype as object;
    const routeMethods = actionMetaStore.get(proto) ?? new Map<string, ActionMeta>();

    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (typeof descriptor?.value !== 'function') continue;
      if (routeMethods.has(name)) continue;
      if (RESERVED_KEYS.has(name)) {
        throw new Error(
          `[TypeMVC] Controller "${target.name}" has a non-route method named "${name}" ` +
            `which conflicts with reserved context key "${name}". ` +
            `Rename the method, or mark it as a route method with a verb decorator.`,
        );
      }
    }

    controllerMetaStore.set(target, { basePath });
    _routeRegistry.add(target);
  };
}

// ---------------------------------------------------------------------------
// @retain(ttlMs?): controller retention policy
// ---------------------------------------------------------------------------

/**
 * Marks a controller for instance retention across navigations.
 * The same instance is reused when the user navigates back to the route.
 *
 * @param ttlMs - Optional time-to-live in milliseconds for the inactive instance.
 *   When the TTL expires the instance is disposed and a fresh one is created on
 *   the next navigation. Omit for indefinite retention.
 *
 * Example: @retain(300_000) retains the instance for 5 minutes after navigation away.
 * Example: @retain() retains the instance indefinitely until app shutdown.
 */
export function retain(ttlMs?: number): (target: AnyConstructor) => void {
  if (__DEV__ && ttlMs !== undefined && (ttlMs <= 0 || !Number.isFinite(ttlMs))) {
    throw new Error(
      `[TypeMVC] @retain() ttlMs must be a positive finite number. Received: ${String(ttlMs)}`,
    );
  }
  return (target: AnyConstructor): void => {
    retentionMetaStore.set(target, { ttlMs });
  };
}

// ---------------------------------------------------------------------------
// Verb decorators (@get, @post, @put, @patch, @del)
// ---------------------------------------------------------------------------

function makeVerbDecorator(verb: ActionMeta['verb']): (segment?: string) => MethodDec {
  return function (segment?: string): MethodDec {
    return function (target: object, key: string | symbol): void {
      let byMethod = actionMetaStore.get(target);
      if (byMethod === undefined) {
        byMethod = new Map<string, ActionMeta>();
        actionMetaStore.set(target, byMethod);
      }
      byMethod.set(String(key), { verb, segment: segment ?? '' });
    };
  };
}

/**
 * Maps a controller action to a GET route. The optional segment is appended to
 * the controller base path; `{name}` segments bind to action parameters by name.
 *
 * @param segment - Optional path segment relative to the controller base path.
 * @example
 * ```ts
 * @get()        index(): IView { ... }            // GET /todos
 * @get('{id}')  detail(id: string): IView { ... } // GET /todos/{id}
 * ```
 */
export const get = makeVerbDecorator('GET');
/**
 * Maps a controller action to a POST route. Form data submitted to this path is
 * bound to the action's `FormData` parameter (and to DTOs via `bindFormData`).
 *
 * @param segment - Optional path segment relative to the controller base path.
 * @example
 * ```ts
 * @post() create(form: FormData): IView { ... }   // POST /todos
 * ```
 */
export const post = makeVerbDecorator('POST');
/** Maps a controller action to a PUT route. See {@link get} for segment syntax. */
export const put = makeVerbDecorator('PUT');
/** Maps a controller action to a PATCH route. See {@link get} for segment syntax. */
export const patch = makeVerbDecorator('PATCH');
/** Maps a controller action to a DELETE route. See {@link get} for segment syntax. */
export const del = makeVerbDecorator('DELETE');

// ---------------------------------------------------------------------------
// @action: explicit marker for non-route methods (no metadata stored)
// ---------------------------------------------------------------------------

/**
 * Marks a controller method as a non-route action: a method exposed to the view
 * as `context.<name>` rather than mapped to a URL. Useful as an explicit marker
 * for event handlers and helpers invoked from the template.
 */
export function action(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  void target;
  void propertyKey;
  return descriptor;
}

// ---------------------------------------------------------------------------
// @body(DtoClass): binds the request body to a typed DTO parameter
// ---------------------------------------------------------------------------

/**
 * Binds the request body of a mutating-verb action (`@post`, `@put`, `@patch`)
 * to a typed DTO parameter. The router instantiates the DTO, coerces form values
 * to each field's declared `@dataType`, runs the field validators, and primes
 * `context.errors` (so `this.hasErrors()` reflects binding failures) before the
 * action runs. Without `@body`, the action receives the raw `FormData` instead.
 *
 * @param dto - The DTO class (a parameterless constructor) to bind the body to.
 * @example
 * ```ts
 * @post()
 * create(@body(CreateUserDto) user: CreateUserDto): IView {
 *   if (this.hasErrors()) return View('users/new');
 *   this.users.add(user);
 *   return Redirect('/users');
 * }
 * ```
 */
export function body(dto: DtoConstructor): ParameterDecorator {
  return function (target: object, key: string | symbol | undefined, index: number): void {
    if (key === undefined) return;
    let byMethod = bodyMetaStore.get(target);
    if (byMethod === undefined) {
      byMethod = new Map<string, BodyMeta>();
      bodyMetaStore.set(target, byMethod);
    }
    byMethod.set(String(key), { index, dto });
  };
}

// ---------------------------------------------------------------------------
// @guard(guardClass): applies to class or method
// ---------------------------------------------------------------------------

/**
 * Attaches a route guard to a controller (all actions) or a single action.
 * The guard's `canActivate(route)` runs before the action; returning false or a
 * rejected promise cancels navigation. Guards are resolved from the DI container,
 * so they may declare injected dependencies.
 *
 * @param guardClass - A class implementing {@link IRouteGuard}.
 */
export function guard(guardClass: GuardConstructor): DualDecorator {
  const fn = function (target: AnyConstructor | object, key?: string | symbol): void {
    if (key === undefined) {
      let guards = classGuardStore.get(target as AnyConstructor);
      if (guards === undefined) {
        guards = [];
        classGuardStore.set(target as AnyConstructor, guards);
      }
      guards.push(guardClass);
    } else {
      let byMethod = methodGuardStore.get(target);
      if (byMethod === undefined) {
        byMethod = new Map<string, GuardConstructor[]>();
        methodGuardStore.set(target, byMethod);
      }
      const methodName = String(key);
      let guards = byMethod.get(methodName);
      if (guards === undefined) {
        guards = [];
        byMethod.set(methodName, guards);
      }
      guards.push(guardClass);
    }
  };
  return fn;
}

// ---------------------------------------------------------------------------
// @layout(layoutClass): applies to class or method; last applied wins
// ---------------------------------------------------------------------------

/**
 * Selects the layout that wraps a controller's rendered views, or overrides it
 * for a single action. Accepts a layout name (matching a registered layout glob
 * entry) or a layout constructor. An action-level `@layout` overrides the
 * controller-level one.
 *
 * @param layoutClassOrName - The layout name string or layout constructor.
 */
export function layout(layoutClassOrName: LayoutConstructor | string): DualDecorator {
  const fn = function (target: AnyConstructor | object, key?: string | symbol): void {
    if (key === undefined) {
      classLayoutStore.set(target as AnyConstructor, layoutClassOrName);
    } else {
      let byMethod = methodLayoutStore.get(target);
      if (byMethod === undefined) {
        byMethod = new Map<string, LayoutConstructor | string>();
        methodLayoutStore.set(target, byMethod);
      }
      byMethod.set(String(key), layoutClassOrName);
    }
  };
  return fn;
}

// ---------------------------------------------------------------------------
// Metadata readers (used by the router and other framework modules)
// ---------------------------------------------------------------------------

export function getControllerMeta(cls: AnyConstructor): ControllerMeta | undefined {
  return controllerMetaStore.get(cls);
}

export function getRetentionMeta(cls: AnyConstructor): RetentionMeta | undefined {
  return retentionMetaStore.get(cls);
}

export function getActionMeta(proto: object, methodName: string): ActionMeta | undefined {
  return actionMetaStore.get(proto)?.get(methodName);
}

export function getAllActionMeta(proto: object): ReadonlyMap<string, ActionMeta> {
  return actionMetaStore.get(proto) ?? new Map<string, ActionMeta>();
}

export function getClassGuards(cls: AnyConstructor): readonly GuardConstructor[] {
  // Decorators apply bottom-to-top; reverse so guards run in declaration (top-to-bottom) order.
  return [...(classGuardStore.get(cls) ?? [])].reverse();
}

export function getMethodGuards(proto: object, methodName: string): readonly GuardConstructor[] {
  return [...(methodGuardStore.get(proto)?.get(methodName) ?? [])].reverse();
}

export function getClassLayout(cls: AnyConstructor): LayoutConstructor | string | undefined {
  return classLayoutStore.get(cls);
}

export function getBodyMeta(proto: object, methodName: string): BodyMeta | undefined {
  return bodyMetaStore.get(proto)?.get(methodName);
}

export function getMethodLayout(proto: object, methodName: string): LayoutConstructor | string | undefined {
  return methodLayoutStore.get(proto)?.get(methodName);
}
