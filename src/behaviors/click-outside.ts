import { onCleanup, _hasOwner } from '../reactivity/signal.js';

/**
 * Reads `globalThis.document`, which is absent outside a browser, so this is a
 * genuine runtime check and not a type level one.
 */
function getDocument(): Document | null {
  const doc = (globalThis as { document?: Document }).document;
  return doc ?? null;
}

/**
 * Calls the handler on a pointer press that starts outside the element, and
 * removes its listener on dispose. It listens on `pointerdown` rather than
 * `click`, so a press that begins outside dismisses before the click completes,
 * and it composes with `ref`: a component gets its element from `ref` and hands
 * it here. An element removed from the document while the listener is live is
 * treated as a press outside it and does not throw.
 *
 * Call it from a component's `@local` block, where teardown is tied to the
 * component, or from a service, where you call the returned `dispose` yourself.
 *
 * @param element - The element a press inside is treated as inside.
 * @param handler - Called with the `PointerEvent` on a press outside `element`.
 * @returns A dispose function that removes the listener. Idempotent.
 * @example
 * ```ts
 * clickOutside(panelRef, () => open.set(false));
 * ```
 */
export function clickOutside(
  element: Element,
  handler: (event: PointerEvent) => void,
): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && element.contains(target)) return;
    handler(event);
  };

  const doc = getDocument();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (doc !== null) doc.removeEventListener('pointerdown', onPointerDown);
  };

  if (doc !== null) doc.addEventListener('pointerdown', onPointerDown);
  // Tie teardown to the component owner scope when there is one. In the common
  // case it is called from a ref callback at mount time, past the owner scope, and
  // the ref returns this dispose so the Fragment tears it down instead.
  if (_hasOwner()) onCleanup(dispose);

  return dispose;
}
