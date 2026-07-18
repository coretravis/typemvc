import type { ReadonlySignal } from '../types/index.js';
import { signal, onCleanup, _hasOwner } from '../reactivity/signal.js';

/**
 * A {@link ReadonlySignal} produced by {@link mediaQuery}, extended with an
 * explicit `dispose`. A component's `@local` block ties the teardown to the
 * owner scope automatically; a service with no owner scope calls `dispose`
 * itself to remove the underlying change listener.
 */
export interface MediaQuerySignal extends ReadonlySignal<boolean> {
  /** Removes the `matchMedia` change listener. Idempotent. */
  readonly dispose: () => void;
}

/**
 * Reads `globalThis.matchMedia`, which is absent outside a browser, so this is a
 * genuine runtime check and not a type level one.
 */
function getMatchMedia(query: string): MediaQueryList | null {
  const mm = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
  if (typeof mm !== 'function') return null;
  return mm.call(globalThis, query);
}

/**
 * Reads whether a media query matches right now, or `false` when `matchMedia` is
 * unavailable. This is the one shot read the router uses for
 * `prefers-reduced-motion`, sharing the `matchMedia` access with
 * {@link mediaQuery} rather than each caller reaching for it separately.
 */
export function matchesMedia(query: string): boolean {
  return getMatchMedia(query)?.matches ?? false;
}

/**
 * Tracks a CSS media query as a reactive `ReadonlySignal<boolean>`. The value
 * reflects the current match and updates when the match changes; the change
 * listener is removed on dispose. When `matchMedia` is unavailable the signal
 * holds `false` and never updates.
 *
 * Call it from a component's `@local` block, where teardown is tied to the
 * component, or from a service, where you call the returned `dispose` yourself.
 *
 * @param query - A CSS media query string, for example `(max-width: 640px)`.
 * @returns A {@link MediaQuerySignal}: a boolean signal plus `dispose`.
 * @example
 * ```ts
 * const isNarrow = mediaQuery('(max-width: 640px)');
 * isNarrow.get(); // true when the viewport is 640px or narrower
 * ```
 */
export function mediaQuery(query: string): MediaQuerySignal {
  const list = getMatchMedia(query);
  const inner = signal<boolean>(list?.matches ?? false);

  const onChange = (event: MediaQueryListEvent): void => {
    inner.set(event.matches);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (list !== null) list.removeEventListener('change', onChange);
  };

  if (list !== null) list.addEventListener('change', onChange);
  // Tie teardown to the component owner scope when there is one. Outside it (a
  // service, a mount callback), the caller holds the returned dispose instead.
  if (_hasOwner()) onCleanup(dispose);

  return { get: inner.get, dispose };
}
