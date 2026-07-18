import type { Signal, ReadonlySignal } from '../types/index.js';
import { scheduleEffect } from './scheduler.js';
export { batch } from './scheduler.js';

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
type EffectCallback = () => void | (() => void);

type Subscriber = EffectNode | ComputedNode;

interface EffectNode {
  kind: 'effect';
  fn: EffectCallback;
  cleanup: (() => void) | undefined;
  deps: Set<Set<Subscriber>>;
  disposed: boolean;
  firstRunComplete: boolean;
  run(): void;
}

interface ComputedNode {
  kind: 'computed';
  fn: () => unknown;
  value: unknown;
  dirty: boolean;
  disposed: boolean;
  deps: Set<Set<Subscriber>>;
  subscribers: Set<Subscriber>;
}

let currentEffect: Subscriber | null = null;

// ---------------------------------------------------------------------------
// Owner scope
// ---------------------------------------------------------------------------

declare const __DEV__: boolean;

interface Owner {
  readonly disposes: (() => void)[];
}

let currentOwner: Owner | null = null;

/**
 * Framework-internal: true when an owner scope is active, so a caller can
 * register teardown with {@link onCleanup} only when there is an owner to run it,
 * rather than triggering the no-owner warning from a context (a mount callback, a
 * service) where the caller holds its own dispose.
 */
export function _hasOwner(): boolean {
  return currentOwner !== null;
}

/**
 * Framework-internal: runs `fn` with a fresh owner scope active and returns its
 * result together with every effect dispose and onCleanup callback registered
 * during the call.
 */
export function _withOwner<T>(fn: () => T): { value: T; disposes: (() => void)[] } {
  const owner: Owner = { disposes: [] };
  const prev = currentOwner;
  currentOwner = owner;
  try {
    const value = fn();
    return { value, disposes: owner.disposes };
  } finally {
    currentOwner = prev;
  }
}

function trackAccess(subscribers: Set<Subscriber>): void {
  if (currentEffect !== null) {
    subscribers.add(currentEffect);
    currentEffect.deps.add(subscribers);
  }
}

function clearDeps(node: Subscriber): void {
  for (const depSet of node.deps) {
    depSet.delete(node);
  }
  node.deps.clear();
}

function markComputedDirty(node: ComputedNode): void {
  if (node.dirty) return;
  node.dirty = true;
  notifySubscribers(node.subscribers);
}

function notifySubscribers(subscribers: Set<Subscriber>): void {
  for (const sub of [...subscribers]) {
    if (sub.kind === 'effect') {
      if (!sub.disposed) {
        scheduleEffect(sub);
      }
    } else {
      markComputedDirty(sub);
    }
  }
}

/**
 * Creates a reactive signal holding a value. Read it with `.get()` (which tracks
 * the current effect as a dependency) and update it with `.set(value)` or
 * `.update(fn)`. Reads inside an `effect` or `computed` re-run automatically when
 * the value changes.
 *
 * @param initialValue - The initial value held by the signal.
 * @returns A {@link Signal} with `get`, `set`, and `update`.
 * @example
 * ```ts
 * const count = signal(0);
 * count.get();            // 0
 * count.set(1);
 * count.update((n) => n + 1); // 2
 * ```
 */
export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const subscribers = new Set<Subscriber>();

  const get = (): T => {
    trackAccess(subscribers);
    return value;
  };

  const set = (newValue: T): void => {
    if (newValue === value) return;
    value = newValue;
    notifySubscribers(subscribers);
  };

  return {
    get,
    set,
    update: (fn: (current: T) => T): void => {
      set(fn(get()));
    },
  };
}

/**
 * Warns about an effect whose first run subscribed to nothing, which means it can
 * never run again. An effect that disposed itself during that run is a deliberate
 * one-shot and is left alone. Only the first run is checked: an effect that reads a
 * signal and later narrows to no dependencies is still woken by what it read.
 */
function warnIfNeverTracked(node: EffectNode): void {
  if (node.disposed || node.deps.size > 0) return;
  console.warn(
    '[TypeMVC] An effect ran without reading any signal, so it will never run again. ' +
      'This usually means it returned early before reaching a .get(). Read the signals it ' +
      'depends on before any conditional return.',
    new Error('effect() call site').stack ?? '',
  );
}

/**
 * Runs a function immediately and re-runs it whenever any signal it read changes.
 * Dependencies are tracked dynamically on each run. The function may return a
 * cleanup callback, run before the next re-run and on dispose.
 *
 * @param fn - The reactive function; may return a cleanup callback.
 * @returns A dispose function that stops the effect and runs the final cleanup.
 * @example
 * ```ts
 * const name = signal('Ada');
 * const dispose = effect(() => { document.title = name.get(); });
 * name.set('Lovelace'); // effect re-runs, title updates
 * dispose();            // stop tracking
 * ```
 */
export function effect(fn: EffectCallback): () => void {
  const node: EffectNode = {
    kind: 'effect',
    fn,
    cleanup: undefined,
    deps: new Set(),
    disposed: false,
    firstRunComplete: false,
    run: () => {
      if (node.disposed) return;
      clearDeps(node);
      const prev = currentEffect;
      currentEffect = node;
      try {
        if (node.cleanup !== undefined) {
          node.cleanup();
          node.cleanup = undefined;
        }
        const result = node.fn();
        if (typeof result === 'function') {
          node.cleanup = result;
        }
      } finally {
        currentEffect = prev;
      }
      if (!node.firstRunComplete) {
        node.firstRunComplete = true;
        if (__DEV__) {
          warnIfNeverTracked(node);
        }
      }
    },
  };

  const dispose = (): void => {
    if (node.disposed) return;
    node.disposed = true;
    clearDeps(node);
    if (node.cleanup !== undefined) {
      node.cleanup();
      node.cleanup = undefined;
    }
  };

  // Tie this effect to the active owner scope (a component render) so it is
  // disposed with the component's Fragment.
  if (currentOwner !== null) {
    currentOwner.disposes.push(dispose);
  }

  node.run();

  return dispose;
}

/**
 * Registers a teardown callback on the active owner scope (a component render).
 * The callback runs when the component's Fragment is disposed, in reverse
 * registration order so later resources tear down before earlier ones. Called
 * outside a component render it is a no-op, and emits a DEV warning, because
 * there is no owner to attach the callback to.
 *
 * @param fn - The teardown callback; may be async (awaited fire-and-forget).
 * @example
 * ```ts
 * const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
 * document.addEventListener('keydown', onKey);
 * onCleanup(() => document.removeEventListener('keydown', onKey));
 * ```
 */
export function onCleanup(fn: () => void | Promise<void>): void {
  if (currentOwner === null) {
    if (__DEV__) {
      console.warn(
        '[TypeMVC] onCleanup() called outside a component render. The callback will not run. ' +
          "Call it inside a component's @local block or render body.",
      );
    }
    return;
  }
  currentOwner.disposes.push(() => {
    // A synchronous throw propagates to the owner's disposer, which isolates each
    // teardown. An async rejection has no such catcher, so it is observed here and
    // reported rather than left unhandled.
    const result = fn();
    if (result instanceof Promise) {
      result.catch((err: unknown): void => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[TypeMVC] An async onCleanup callback rejected during disposal.', error);
      });
    }
  });
}

/**
 * Runs `fn` without tracking any signal it reads as a dependency of the current
 * effect or computed. Use it when a read must not subscribe the surrounding
 * reactive scope, such as building a keyed row whose own bindings track their
 * inputs while the list's reconcile effect tracks only the source.
 *
 * @param fn - The function to run untracked.
 * @returns Whatever `fn` returns.
 */
export function untrack<T>(fn: () => T): T {
  const prev = currentEffect;
  currentEffect = null;
  try {
    return fn();
  } finally {
    currentEffect = prev;
  }
}

/**
 * Creates a read-only signal derived from other signals. The function is
 * memoized and recomputed lazily only after a dependency changes and the value
 * is next read.
 *
 * @param fn - A function that derives the value from other signals.
 * @returns A {@link ReadonlySignal} exposing `get`.
 * @example
 * ```ts
 * const count = signal(2);
 * const doubled = computed(() => count.get() * 2);
 * doubled.get(); // 4
 * ```
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const node: ComputedNode = {
    kind: 'computed',
    fn,
    value: undefined,
    dirty: true,
    disposed: false,
    deps: new Set(),
    subscribers: new Set(),
  };

  // Tie this computed to the active owner scope (a component render), the same way
  // effect() is, so that when the component's Fragment disposes, the computed cuts
  // its upstream subscriptions. Without this a computed no longer read stays in a
  // long-lived signal's subscriber set for the life of that signal.
  if (currentOwner !== null) {
    currentOwner.disposes.push(() => {
      if (node.disposed) return;
      node.disposed = true;
      clearDeps(node);
    });
  }

  return {
    get: (): T => {
      // A disposed computed is frozen at its last value: it does not recompute or
      // re-subscribe, so reading it after its owner is gone cannot revive the leak.
      if (node.disposed) return node.value as T;
      trackAccess(node.subscribers);
      if (node.dirty) {
        clearDeps(node);
        const prev = currentEffect;
        currentEffect = node;
        try {
          node.value = node.fn();
          node.dirty = false;
        } finally {
          currentEffect = prev;
        }
      }
      return node.value as T;
    },
  };
}
