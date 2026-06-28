import type { Fragment } from './fragment.js';

/**
 * A fragment tagged with a stable identity, produced by {@link keyed}. The
 * reconciler uses the key to move, insert, and remove list items instead of
 * re-rendering the whole list when a signal-bound array changes.
 */
export interface KeyedFragment {
  readonly key: string | number;
  readonly nodes: readonly Node[];
  readonly fragment: Fragment;
}

/**
 * Tags a fragment with a stable key for efficient keyed list reconciliation.
 * Give each item a key that is stable across renders (an id, not the array
 * index) so the renderer can reuse DOM nodes when the list reorders.
 *
 * @param key - A stable identity for this item.
 * @param fragment - The rendered fragment for the item.
 * @returns A {@link KeyedFragment} for use in a signal-bound list.
 */
export function keyed(key: string | number, fragment: Fragment): KeyedFragment {
  return { key, nodes: fragment.nodes, fragment };
}

export function isKeyedFragment(value: unknown): value is KeyedFragment {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.key === 'string' || typeof v.key === 'number') &&
    Array.isArray(v.nodes)
  );
}

/**
 * Maps a list to keyed fragments in one step, the clean form for a reactive list
 * of components or rows. Bind the result to a signal for in place reconciliation.
 *
 * @param items - The source list.
 * @param key - Returns a stable key per item (an id, not the array index).
 * @param render - Renders an item to a {@link Fragment}.
 * @returns One {@link KeyedFragment} per item, in order.
 * @example
 * ```ts
 * data.set('rows', computed(() =>
 *   keyedMap(this.books.get(), (b) => b.id, (b) => html`<BookCard book="${b}" />`)
 * ));
 * ```
 */
export function keyedMap<T>(
  items: readonly T[],
  key: (item: T) => string | number,
  render: (item: T) => Fragment,
): KeyedFragment[] {
  return items.map((item) => keyed(key(item), render(item)));
}
