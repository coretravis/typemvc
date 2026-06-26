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
  run(): void;
}

interface ComputedNode {
  kind: 'computed';
  fn: () => unknown;
  value: unknown;
  dirty: boolean;
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
    void fn();
  });
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
    deps: new Set(),
    subscribers: new Set(),
  };

  return {
    get: (): T => {
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
