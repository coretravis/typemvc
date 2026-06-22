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
//   - Existing key: move its nodes before the cursor if out of order.
//   - New key: insert the KeyedFragment's nodes before the cursor.
// After the walk, any keys remaining in oldMap were removed -- delete their nodes.
//
// Returns the updated key-to-nodes map for use on the next call.
// ---------------------------------------------------------------------------

export function reconcile(
  endSentinel: Comment,
  oldMap: Map<string | number, readonly Node[]>,
  newList: readonly KeyedFragment[],
): Map<string | number, readonly Node[]> {
  const parent = endSentinel.parentNode;
  if (parent === null) return new Map<string | number, readonly Node[]>();

  // DEV: warn on duplicate keys, skip second occurrence
  const seenKeys = new Set<string | number>();
  const filteredList: KeyedFragment[] = [];
  for (const item of newList) {
    if (seenKeys.has(item.key)) {
      if (__DEV__) {
        console.warn(
          `[TypeMVC] Duplicate key "${String(item.key)}" in keyed list. Skipping duplicate entry.`,
        );
      }
      continue;
    }
    seenKeys.add(item.key);
    filteredList.push(item);
  }

  const newMap = new Map<string | number, readonly Node[]>();
  let cursor: Node = endSentinel;

  // Walk right-to-left so insertBefore(node, cursor) yields left-to-right DOM order
  for (const item of [...filteredList].reverse()) {
    const existingNodes = oldMap.get(item.key);

    if (existingNodes !== undefined) {
      oldMap.delete(item.key);
      // Reuse existing DOM nodes -- move right-to-left so leftmost ends up at cursor
      for (const node of [...existingNodes].reverse()) {
        if (node.nextSibling !== cursor) {
          parent.insertBefore(node, cursor);
        }
        cursor = node;
      }
      newMap.set(item.key, existingNodes);
    } else {
      // New key -- insert its nodes right-to-left before cursor
      for (const node of [...item.nodes].reverse()) {
        parent.insertBefore(node, cursor);
        cursor = node;
      }
      newMap.set(item.key, item.nodes);
    }
  }

  // Keys absent from newList: remove their nodes from the DOM
  for (const [, nodes] of oldMap) {
    for (const node of nodes) {
      if (node.parentNode !== null) {
        node.parentNode.removeChild(node);
      }
    }
  }

  return newMap;
}
