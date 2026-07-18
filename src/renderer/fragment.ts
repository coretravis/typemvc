/**
 * A callback registered on a {@link Fragment} to run once its nodes are in the
 * document. Returning a function registers a teardown that runs on disposal.
 */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- the callback either returns a teardown or nothing
export type MountCallback = () => (() => void) | void;

/**
 * Opaque wrapper around a collection of live DOM nodes produced by the html
 * tagged template. Callers insert these nodes via node bindings; the framework
 * calls mount() once they are in the document and dispose() when the fragment
 * leaves it.
 */
export class Fragment {
  readonly nodes: readonly Node[];
  private readonly _disposes: (() => void)[];
  private readonly _mounts: MountCallback[];
  private _mounted: boolean;
  private _disposed: boolean;

  constructor(nodes: Node[]) {
    this.nodes = nodes.slice();
    this._disposes = [];
    this._mounts = [];
    this._mounted = false;
    this._disposed = false;
  }

  addDispose(fn: () => void): void {
    this._disposes.push(fn);
  }

  /**
   * Registers a callback to run when this fragment is mounted. Registering on an
   * already mounted fragment runs the callback at once, which is how content
   * inserted into a live reactive region or keyed list gets its refs.
   */
  addMount(fn: MountCallback): void {
    if (this._disposed) return;
    if (this._mounted) {
      this.runMount(fn);
      return;
    }
    this._mounts.push(fn);
  }

  /**
   * Signals that these nodes are now in the document. Runs every registered
   * mount callback once. A disposed fragment never mounts, so a callback left
   * pending by content that was replaced before its parent mounted is dropped
   * rather than run against detached nodes.
   */
  mount(): void {
    if (this._mounted || this._disposed) return;
    this._mounted = true;
    const pending = this._mounts.splice(0, this._mounts.length);
    for (const fn of pending) {
      this.runMount(fn);
    }
  }

  dispose(): void {
    this._disposed = true;
    this._mounts.length = 0;
    let fn = this._disposes.pop();
    while (fn !== undefined) {
      // Each teardown runs isolated: a throw in one is reported and does not stop
      // the rest, so one broken cleanup cannot leak every teardown after it.
      try {
        fn();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[TypeMVC] A fragment teardown threw during disposal.', error);
      }
      fn = this._disposes.pop();
    }
  }

  private runMount(fn: MountCallback): void {
    // Each mount callback runs isolated, mirroring disposal: a throw in one ref or
    // mount callback is reported and does not stop the rest, so one broken callback
    // cannot strand every mount effect after it.
    try {
      const teardown = fn();
      if (typeof teardown === 'function') {
        this._disposes.push(teardown);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[TypeMVC] A fragment mount callback threw while mounting.', error);
    }
  }
}
