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

  node.run();

  return (): void => {
    node.disposed = true;
    clearDeps(node);
    if (node.cleanup !== undefined) {
      node.cleanup();
      node.cleanup = undefined;
    }
  };
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
