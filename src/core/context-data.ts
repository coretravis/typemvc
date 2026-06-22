/**
 * The ViewBag backing store. A controller's `this.data` is a ContextData
 * instance; values set on it are exposed to every view rendered by that
 * controller as `context.data.*` (loosely typed, unlike the typed
 * `context.model`).
 */
export class ContextData {
  private readonly _store = Object.create(null) as Record<string, unknown>;

  set(key: string, value: unknown): void {
    this._store[key] = value;
  }

  /** Returns all stored entries. Used by context assembly. */
  getAll(): Readonly<Record<string, unknown>> {
    return this._store;
  }
}
