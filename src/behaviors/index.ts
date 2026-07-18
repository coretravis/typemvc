/**
 * Headless behaviours: small primitives that need cleanup and carry no UI
 * policy. Each registers its teardown with `onCleanup`, so it dies with the
 * component's Fragment when called from a `@local` block, and each also returns
 * an explicit dispose (or a signal carrying one) so a service with no owner
 * scope can tear it down itself.
 *
 * This is a separate entry point from the core barrel so the framework's core
 * surface stays small and the choice to use a behaviour is visible in the
 * import.
 */

export { persisted } from './persisted.js';
export type { PersistedOptions, PersistedSignal } from './persisted.js';

export { mediaQuery } from './media-query.js';
export type { MediaQuerySignal } from './media-query.js';

export { hotkey } from './hotkey.js';
export type { HotkeyOptions } from './hotkey.js';

export { clickOutside } from './click-outside.js';
