/**
 * Opaque wrapper around a collection of live DOM nodes produced by the html
 * tagged template. Callers insert these nodes via node bindings; the framework
 * calls dispose() when the fragment leaves the DOM.
 */
export class Fragment {
  readonly nodes: readonly Node[];
  private readonly _disposes: (() => void)[];

  constructor(nodes: Node[]) {
    this.nodes = nodes.slice();
    this._disposes = [];
  }

  addDispose(fn: () => void): void {
    this._disposes.push(fn);
  }

  dispose(): void {
    let fn = this._disposes.pop();
    while (fn !== undefined) {
      fn();
      fn = this._disposes.pop();
    }
  }
}
