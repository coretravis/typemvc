declare const __DEV__: boolean;

import type { KeyedFragment } from './keyed.js';

// ---------------------------------------------------------------------------
// clearRegion -- remove all nodes between two sentinel comment nodes
// ---------------------------------------------------------------------------

export function clearRegion(startSentinel: Comment, endSentinel: Comment): void {
  const parent = endSentinel.parentNode;
  if (parent === null) return;
  let node = startSentinel.nextSibling;
  while (node !== null && node !== endSentinel) {
    const next = node.nextSibling;
    parent.removeChild(node);
    node = next;
  }
}

// ---------------------------------------------------------------------------
// reconcile -- keyed DOM reconciler
//
// Walks newList right-to-left, maintaining a "cursor" node that represents
// the next insertion point. For each item:
//   - Existing key: move its nodes before the cursor if out of order, and
//     dispose the freshly built (redundant) fragment for that key.
//   - New key: insert the KeyedFragment's nodes before the cursor.
// After the walk, any keys remaining in oldMap were removed -- remove their
// nodes and dispose their fragments so binding effects do not leak.
//
// Tracks the KeyedFragment (not bare nodes) for each key so the source fragment
// is reachable for disposal. Returns the updated map for use on the next call.
// ---------------------------------------------------------------------------

export function reconcile(
  endSentinel: Comment,
  oldMap: Map<string | number, KeyedFragment>,
  newList: readonly KeyedFragment[],
): Map<string | number, KeyedFragment> {
  const parent = endSentinel.parentNode;
  if (parent === null) return new Map<string | number, KeyedFragment>();

  // DEV: warn on duplicate keys, skip and dispose the second occurrence so its
  // binding effects (created when the duplicate fragment was built) do not leak.
  const seenKeys = new Set<string | number>();
  const filteredList: KeyedFragment[] = [];
  for (const item of newList) {
    if (seenKeys.has(item.key)) {
      if (__DEV__) {
        console.warn(
          `[TypeMVC] Duplicate key "${String(item.key)}" in keyed list. Skipping duplicate entry.`,
        );
      }
      item.fragment.dispose();
      continue;
    }
    seenKeys.add(item.key);
    filteredList.push(item);
  }

  const newMap = new Map<string | number, KeyedFragment>();
  let cursor: Node = endSentinel;

  // Walk right-to-left so insertBefore(node, cursor) yields left-to-right DOM order
  for (const item of [...filteredList].reverse()) {
    const existing = oldMap.get(item.key);

    if (existing !== undefined) {
      oldMap.delete(item.key);
      // The retained nodes already carry the live bindings for this key.
      if (item.fragment !== existing.fragment) {
        item.fragment.dispose();
      }
      // Reuse existing DOM nodes -- move right-to-left so leftmost ends up at cursor
      for (const node of [...existing.nodes].reverse()) {
        if (node.nextSibling !== cursor) {
          parent.insertBefore(node, cursor);
        }
        cursor = node;
      }
      newMap.set(item.key, existing);
    } else {
      // New key -- insert its nodes right-to-left before cursor
      for (const node of [...item.nodes].reverse()) {
        parent.insertBefore(node, cursor);
        cursor = node;
      }
      newMap.set(item.key, item);
    }
  }

  // Keys absent from newList: remove their nodes and dispose their fragments
  for (const [, entry] of oldMap) {
    for (const node of entry.nodes) {
      if (node.parentNode !== null) {
        node.parentNode.removeChild(node);
      }
    }
    entry.fragment.dispose();
  }

  return newMap;
}
