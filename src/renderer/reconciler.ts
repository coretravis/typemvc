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
//   - Existing key, same rendered content: move the retained nodes before the
//     cursor if out of order and dispose the freshly built (redundant) fragment,
//     so node identity (focus, selection, scroll) survives a reorder.
//   - Existing key, changed content: take down the retained row and put the
//     freshly rendered one in its place, so changed static content is shown.
//   - New key: insert the KeyedFragment's nodes before the cursor.
// After the walk, any keys remaining in oldMap were removed -- remove their
// nodes and dispose their fragments so binding effects do not leak.
//
// A retained row and a freshly built one for the same key compare equal when a
// signal binding has already driven the retained nodes to the current value, so a
// signal-bound row is reused and keeps updating; a plain value that changed makes
// them differ, so the row is replaced. Returns the updated map, whose entry for a
// replaced or new key holds the freshly built KeyedFragment the caller must mount.
// ---------------------------------------------------------------------------

/**
 * True when two node lists render the same content, compared structurally through
 * isEqualNode: same tags, attributes, and text. Live DOM state a user changed (a
 * typed input value, a checkbox) is not serialized, so a reordered row keeps it.
 */
function sameRendered(a: readonly Node[], b: readonly Node[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const an = a[i];
    const bn = b[i];
    if (an === undefined || bn === undefined || !an.isEqualNode(bn)) return false;
  }
  return true;
}

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
      const reuse = item.fragment === existing.fragment || sameRendered(existing.nodes, item.nodes);
      if (reuse) {
        // Same content: the retained nodes already carry the live bindings for this
        // key, so keep them and dispose the redundant freshly built fragment.
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
        // Changed content under the same key: remove the retained row, dispose its
        // fragment so its bindings do not leak, and insert the freshly built one.
        for (const node of existing.nodes) {
          if (node.parentNode !== null) {
            node.parentNode.removeChild(node);
          }
        }
        existing.fragment.dispose();
        for (const node of [...item.nodes].reverse()) {
          parent.insertBefore(node, cursor);
          cursor = node;
        }
        newMap.set(item.key, item);
      }
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
