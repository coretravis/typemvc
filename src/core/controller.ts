import type { ILogger } from '../logging/types.js';
import type { DisposeReason, ResolvedRoute } from '../types/index.js';
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

  readonly #fieldErrors = new Map<string, string>();
  readonly #cleanupCallbacks: (() => void | Promise<void>)[] = [];
  #initialized = false;

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

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars -- base no-op; parameters define the override contract for subclasses
  protected onActionError(_error: Error, _methodName: string): void {}
}
