import { signal, effect, untrack, _withOwner } from '../reactivity/signal.js';
import type { ReadonlySignal, Signal } from '../types/index.js';
import { Fragment } from './fragment.js';

declare const __DEV__: boolean;

interface KeyedRow<T> {
  readonly itemSignal: Signal<T>;
  readonly fragment: Fragment;
  readonly nodes: readonly Node[];
}

/**
 * A fine-grained keyed list. Each row is built once per key and updated in place
 * through a per-row signal, so a handler, `ref`, or component prop that reads
 * `item.get()` always sees the current item, and the row keeps its DOM node
 * identity across an in-place update and a reorder (focus, selection, and scroll
 * survive).
 *
 * Prefer this over a `keyedMap` of pre-built fragments when a row captures
 * per-render data in a closure, `ref`, or prop. `keyed`/`keyedMap` rebuild a
 * fragment per render and reconcile by comparing serialized DOM, so a row whose
 * markup is unchanged keeps its old bindings even if a captured value changed;
 * `keyedList` has no such limitation because the row is not rebuilt.
 *
 * @param source - The reactive list: a {@link ReadonlySignal} of the array or a
 *   function returning the current array. The reconcile tracks only this.
 * @param keyOf - Returns a stable key per item (an id, not the array index).
 * @param render - Builds a row once per key from a `ReadonlySignal` of its item.
 * @returns A {@link Fragment} to interpolate in a template.
 * @example
 * ```ts
 * // In a controller view model or a component @local block:
 * const list = keyedList(books, (b) => b.id, (book) => html`
 *   <li onclick="${() => open(book.get().id)}">${computed(() => book.get().title)}</li>
 * `);
 * ```
 * ```tmvc
 * <ul>${context.model.list}</ul>
 * ```
 */
export function keyedList<T>(
  source: ReadonlySignal<readonly T[]> | (() => readonly T[]),
  keyOf: (item: T) => string | number,
  render: (item: ReadonlySignal<T>, key: string | number) => Fragment,
): Fragment {
  const read: () => readonly T[] =
    typeof source === 'function' ? source : (): readonly T[] => source.get();
  const start = document.createComment('tmvc-kl-start');
  const end = document.createComment('tmvc-kl-end');
  const container = new Fragment([start, end]);

  const rows = new Map<string | number, KeyedRow<T>>();

  const buildRow = (item: T, key: string | number): KeyedRow<T> => {
    const itemSignal = signal(item);
    // Untracked so the reconcile effect subscribes only to the source, and owner
    // scoped so any effect or onCleanup the row registers disposes with the row.
    const { value: fragment, disposes } = untrack(() =>
      _withOwner(() => render(itemSignal, key)),
    );
    for (const dispose of disposes) fragment.addDispose(dispose);
    return { itemSignal, fragment, nodes: fragment.nodes };
  };

  const reconcile = (): void => {
    const items = read();
    const parent = end.parentNode;
    if (parent === null) return;

    const order: KeyedRow<T>[] = [];
    const seen = new Set<string | number>();
    const fresh: KeyedRow<T>[] = [];
    for (const item of items) {
      const key = keyOf(item);
      if (seen.has(key)) {
        if (__DEV__) {
          console.warn(
            `[TypeMVC] Duplicate key "${String(key)}" in a keyed list. Skipping the duplicate entry.`,
          );
        }
        continue;
      }
      seen.add(key);
      let row = rows.get(key);
      if (row === undefined) {
        row = buildRow(item, key);
        rows.set(key, row);
        fresh.push(row);
      } else {
        // Update in place: the row's own bindings read the item signal and update.
        row.itemSignal.set(item);
      }
      order.push(row);
    }

    // Remove rows whose key is no longer present, disposing their bindings.
    for (const [key, row] of [...rows]) {
      if (seen.has(key)) continue;
      for (const node of row.nodes) {
        if (node.parentNode !== null) node.parentNode.removeChild(node);
      }
      row.fragment.dispose();
      rows.delete(key);
    }

    // Order the nodes to match `order`, moving right-to-left before the end sentinel
    // so a retained row keeps its nodes and only moves when it is out of place.
    let cursor: Node = end;
    for (let i = order.length - 1; i >= 0; i--) {
      const row = order[i];
      if (row === undefined) continue;
      for (let j = row.nodes.length - 1; j >= 0; j--) {
        const node = row.nodes[j];
        if (node === undefined) continue;
        if (node.nextSibling !== cursor) parent.insertBefore(node, cursor);
        cursor = node;
      }
    }

    // Mount rows built this pass, now that they are in the document.
    for (const row of fresh) row.fragment.mount();
  };

  // Set up once the container is mounted, so the sentinels have a parent for the
  // initial build. The reconcile effect re-runs when the source changes.
  container.addMount(() => effect(reconcile));
  container.addDispose(() => {
    for (const row of rows.values()) row.fragment.dispose();
    rows.clear();
  });

  return container;
}
