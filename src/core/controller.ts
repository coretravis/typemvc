import type { ILogger } from '../logging/types.js';
import type { DisposeReason, IRouter, ResolvedRoute } from '../types/index.js';
import { ContextData } from './context-data.js';

type LifecycleErrorHandler = (err: Error, hookName: string) => void;

let _log: ILogger | undefined;

/** Framework-internal: called once by bootstrap to wire in the debug logger. */
export function _initControllerLogger(logger: ILogger): void {
  _log = logger;
}

/**
 * Base class for all controllers. Provides the `data` ViewBag, field-error
 * priming for validation, and lifecycle hooks (`onInit`, `onActivate`,
 * `onDeactivate`, `onDispose`, `onCleanup`) that the router invokes around
 * navigation. Extend it and decorate the subclass with `@controller`.
 *
 * @example
 * ```ts
 * @controller('/todos')
 * class TodoController extends Controller {
 *   @get() index(): IView { return View(); }
 * }
 * ```
 */
export class Controller {
  /** ViewBag: set values here in any lifecycle hook or action body; they appear as context.data.* in every view rendered by this controller. */
  protected readonly data: ContextData = new ContextData();

  /**
   * The page title for the navigation being handled. Assign it in an action to
   * compute a title from data the action already holds, including data the view
   * model never carries. It overrides a `@title` decorator, and it is cleared at
   * the start of every dispatch, so a retained controller cannot carry one visit's
   * title into the next.
   *
   * A title that is the same on every visit is a `@title` decorator instead.
   *
   * @example
   * ```ts
   * @get('{id}')
   * async detail(id: string): Promise<IView<RecordData>> {
   *   const record = await this.api.record(id);
   *   const tenant = await this.tenants.current();
   *   this.title = `${record.name} at ${tenant.name}`;
   *   return View({ record });
   * }
   * ```
   */
  protected title: string | undefined;

  readonly #fieldErrors = new Map<string, string>();
  readonly #cleanupCallbacks: (() => void | Promise<void>)[] = [];
  #initialized = false;
  #router: IRouter | undefined;
  #signal: AbortSignal | undefined;

  /**
   * The `AbortSignal` for the navigation being handled. Pass it to a `fetch` (or
   * anything that takes one) so the request is cancelled when the user navigates
   * away mid flight: `this.api.record(id, { signal: this.signal })`. It is a fresh,
   * unaborted signal on every dispatch, including a second visit to a retained
   * controller, and it aborts when this navigation is superseded or the controller
   * is deactivated.
   *
   * @example
   * ```ts
   * @get('{id}')
   * async detail(id: string): Promise<IView<RecordData>> {
   *   const record = await this.api.record(id, { signal: this.signal });
   *   return View({ record });
   * }
   * ```
   */
  protected get signal(): AbortSignal {
    const signal = this.#signal;
    if (signal === undefined) {
      throw new Error(
        `[TypeMVC] "${this.constructor.name}" has no signal. The framework assigns one per ` +
          `dispatch, so this instance was reached outside a navigation. In a test, drive it ` +
          `with createControllerTest() or createTestApp().`,
      );
    }
    return signal;
  }

  /** Framework-internal: assigns the navigation's abort signal before the action runs. */
  _setSignal(signal: AbortSignal): void {
    this.#signal = signal;
  }

  /**
   * The router, for navigating imperatively from an action, a lifecycle hook, or
   * a non-route method. Prefer returning `Redirect()` from an action that decides
   * during navigation that the user belongs elsewhere; use this when the code
   * doing the navigating is not producing a view.
   */
  protected get router(): IRouter {
    const router = this.#router;
    if (router === undefined) {
      throw new Error(
        `[TypeMVC] "${this.constructor.name}" has no router. The framework assigns it when it ` +
          `constructs a controller, so this instance was created outside the router. In a test, ` +
          `build it with createControllerTest() or createTestApp().`,
      );
    }
    return router;
  }

  /** Framework-internal: assigns the router after construction, before any hook runs. */
  _setRouter(router: IRouter): void {
    this.#router = router;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks (override in subclass; base implementations are no-ops)
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-empty-function -- base no-op; override in subclass
  protected onInit(): void | Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars -- base no-op
  protected onActivate(_route: ResolvedRoute): void | Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars -- base no-op
  protected onDeactivate(_route: ResolvedRoute): void | Promise<void> {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars -- base no-op
  protected onDispose(_reason: DisposeReason): void | Promise<void> {}

  /**
   * Register a cleanup callback that runs during controller disposal.
   * Callbacks execute in reverse registration order so later-registered
   * resources (which may depend on earlier ones) are torn down first.
   */
  protected onCleanup(fn: () => void | Promise<void>): void {
    this.#cleanupCallbacks.push(fn);
  }

  // ---------------------------------------------------------------------------
  // Framework-internal lifecycle drivers (called by the router)
  // ---------------------------------------------------------------------------

  async _runInit(onError?: LifecycleErrorHandler): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    _log?.debug(`${this.constructor.name} onInit`);
    try {
      await Promise.resolve(this.onInit());
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)), 'onInit');
    }
  }

  async _activate(route: ResolvedRoute, onError?: LifecycleErrorHandler): Promise<void> {
    _log?.debug(`${this.constructor.name} onActivate`, { pathname: route.pathname });
    try {
      await Promise.resolve(this.onActivate(route));
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)), 'onActivate');
    }
  }

  async _deactivate(route: ResolvedRoute, onError?: LifecycleErrorHandler): Promise<void> {
    _log?.debug(`${this.constructor.name} onDeactivate`, { pathname: route.pathname });
    try {
      await Promise.resolve(this.onDeactivate(route));
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)), 'onDeactivate');
    }
  }

  /**
   * Dispose this controller: call onDispose() then run all registered
   * onCleanup() callbacks in reverse order. Errors from any step are
   * reported via onError; remaining steps always run.
   */
  async _dispose(reason: DisposeReason, onError?: LifecycleErrorHandler): Promise<void> {
    _log?.debug(`${this.constructor.name} onDispose`, { reason });
    try {
      await Promise.resolve(this.onDispose(reason));
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)), 'onDispose');
    }
    const count = this.#cleanupCallbacks.length;
    for (let i = count - 1; i >= 0; i--) {
      try {
        const cb = this.#cleanupCallbacks[i];
        await Promise.resolve(cb?.());
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)), 'onCleanup');
      }
    }
    _log?.debug(`${this.constructor.name} onCleanup`, { callbacks: count });
    this.#cleanupCallbacks.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Field error tracking (used by the model binder and validation pipeline)
  // ---------------------------------------------------------------------------

  hasErrors(): boolean {
    return this.#fieldErrors.size > 0;
  }

  addError(field: string, message: string): void {
    this.#fieldErrors.set(field, message);
  }

  /** Framework-internal: seeds the error map with validation failures from the model binder. */
  _primeErrors(errors: Readonly<Record<string, string>>): void {
    for (const [field, message] of Object.entries(errors)) {
      this.#fieldErrors.set(field, message);
    }
  }

  /** Framework-internal: returns the accumulated field error map for context assembly. */
  _getFieldErrors(): ReadonlyMap<string, string> {
    return this.#fieldErrors;
  }

  /** Framework-internal: clears the error map at the start of each navigation. */
  _clearFieldErrors(): void {
    this.#fieldErrors.clear();
  }

  /** Framework-internal: returns the ViewBag for context assembly. */
  _getViewBag(): ContextData {
    return this.data;
  }

  /** Framework-internal: returns the title the action assigned, if it assigned one. */
  _getTitle(): string | undefined {
    return this.title;
  }

  /**
   * Framework-internal: clears per-dispatch state at the start of every navigation.
   * A retained controller survives the navigation away from it, so anything an
   * action assigned would otherwise still be there on the next visit: a route that
   * assigns no title would show the previous one, and a form invalid on one visit
   * would carry its field errors into the next.
   */
  _resetForDispatch(): void {
    this.title = undefined;
    this._clearFieldErrors();
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars -- base no-op; parameters define the override contract for subclasses
  protected onActionError(_error: Error, _methodName: string): void {}
}

/** Internal view of the protected onActionError hook, for the framework callers below. */
interface ControllerWithActionError {
  onActionError(error: Error, methodName: string): void;
}

function isOnActionErrorOverridden(instance: Controller): boolean {
  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto !== null && proto !== Controller.prototype) {
    if (Object.prototype.hasOwnProperty.call(proto, 'onActionError')) {
      return true;
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}

/**
 * Framework-internal: runs the controller's own `onActionError` override for a
 * failed action, if it declares one. Returns true when the override ran and
 * handled the error, false when there is no override or it re-threw, in which
 * case the caller falls through to the application-level handler.
 */
export function _invokeOnActionError(
  instance: Controller,
  error: Error,
  methodName: string,
): boolean {
  if (!isOnActionErrorOverridden(instance)) return false;
  try {
    (instance as unknown as ControllerWithActionError).onActionError(error, methodName);
    return true;
  } catch {
    return false;
  }
}
