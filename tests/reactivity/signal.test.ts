import { describe, it, expect, beforeEach } from 'vitest';
import { signal, effect, computed, batch } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';

// Each test runs flush() after to drain any microtasks queued during the test.
// beforeEach resets scheduler state indirectly by draining any leftover pending effects.
beforeEach(() => {
  flush();
});

// ---------------------------------------------------------------------------
// signal()
// ---------------------------------------------------------------------------

describe('signal', () => {
  it('returns the initial value via get()', () => {
    const s = signal(42);
    expect(s.get()).toBe(42);
  });

  it('set() updates the value', () => {
    const s = signal(0);
    s.set(10);
    expect(s.get()).toBe(10);
  });

  it('set() with the same value is a no-op (effect not scheduled)', () => {
    const s = signal(5);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(5); // same value
    flush();
    expect(runs).toBe(1); // still 1, no re-run
    dispose();
  });

  it('update() applies a function to the current value', () => {
    const s = signal(3);
    s.update((n) => n * 2);
    expect(s.get()).toBe(6);
  });

  it('update() reads the latest value', () => {
    const s = signal(10);
    s.set(20);
    s.update((n) => n + 5);
    expect(s.get()).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// effect()
// ---------------------------------------------------------------------------

describe('effect', () => {
  it('runs the function immediately on creation', () => {
    let ran = false;
    const dispose = effect(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    dispose();
  });

  it('reading a signal inside an effect registers it as a dependency', () => {
    const s = signal(1);
    let seen = 0;
    const dispose = effect(() => {
      seen = s.get();
    });
    expect(seen).toBe(1);
    s.set(2);
    flush();
    expect(seen).toBe(2);
    dispose();
  });

  it('updates the signal re-runs effects via the scheduler, not synchronously', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(1);
    expect(runs).toBe(1); // not yet: async
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('returns a dispose function that stops the effect', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    dispose();
    s.set(99);
    flush();
    expect(runs).toBe(1); // no re-run after dispose
  });

  it('calls the cleanup function before each re-run', () => {
    const s = signal(0);
    const log: string[] = [];
    const dispose = effect(() => {
      s.get();
      log.push('run');
      return () => {
        log.push('cleanup');
      };
    });
    expect(log).toEqual(['run']);
    s.set(1);
    flush();
    expect(log).toEqual(['run', 'cleanup', 'run']);
    s.set(2);
    flush();
    expect(log).toEqual(['run', 'cleanup', 'run', 'cleanup', 'run']);
    dispose();
  });

  it('calls the cleanup function on dispose', () => {
    const s = signal(0);
    let cleaned = false;
    const dispose = effect(() => {
      s.get();
      return () => {
        cleaned = true;
      };
    });
    expect(cleaned).toBe(false);
    dispose();
    expect(cleaned).toBe(true);
  });

  it('does not call cleanup again after dispose if no cleanup pending', () => {
    let cleanupCount = 0;
    const dispose = effect(() => {
      return () => {
        cleanupCount++;
      };
    });
    // Cleanup was stored from initial run.
    dispose();
    expect(cleanupCount).toBe(1);
    // Calling dispose again should not double-clean.
    dispose();
    expect(cleanupCount).toBe(1);
  });

  it('uses dynamic dependency tracking: stops tracking signal when branch changes', () => {
    const flag = signal(true);
    const a = signal(1);
    const b = signal(100);
    let runs = 0;
    let seen = 0;
    const dispose = effect(() => {
      runs++;
      seen = flag.get() ? a.get() : b.get();
    });
    expect(runs).toBe(1);
    expect(seen).toBe(1);

    // Changing a re-runs (flag is true, a is tracked).
    a.set(2);
    flush();
    expect(runs).toBe(2);
    expect(seen).toBe(2);

    // Flip flag to false: now b is tracked, a is not.
    flag.set(false);
    flush();
    expect(runs).toBe(3);
    expect(seen).toBe(100);

    // Changing a no longer triggers the effect.
    a.set(999);
    flush();
    expect(runs).toBe(3);

    // Changing b does trigger it.
    b.set(200);
    flush();
    expect(runs).toBe(4);
    expect(seen).toBe(200);

    dispose();
  });

  it('deduplicates: multiple mutations produce a single re-run per effect', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(1);
    s.set(2);
    s.set(3);
    flush();
    expect(runs).toBe(2); // one re-run despite three sets
    dispose();
  });
});

// ---------------------------------------------------------------------------
// computed()
// ---------------------------------------------------------------------------

describe('computed', () => {
  it('does not evaluate until first get()', () => {
    let evalCount = 0;
    const s = signal(1);
    computed(() => {
      evalCount++;
      return s.get() * 2;
    });
    expect(evalCount).toBe(0);
  });

  it('returns the correct value on first get()', () => {
    const s = signal(5);
    const doubled = computed(() => s.get() * 2);
    expect(doubled.get()).toBe(10);
  });

  it('caches the result and does not recompute when deps have not changed', () => {
    let evalCount = 0;
    const s = signal(3);
    const c = computed(() => {
      evalCount++;
      return s.get() + 1;
    });
    expect(c.get()).toBe(4);
    expect(evalCount).toBe(1);
    expect(c.get()).toBe(4);
    expect(evalCount).toBe(1); // no recompute
  });

  it('recomputes when a dependency changes', () => {
    const s = signal(10);
    const c = computed(() => s.get() * 3);
    expect(c.get()).toBe(30);
    s.set(20);
    expect(c.get()).toBe(60);
  });

  it('is trackable: an effect can depend on a computed', () => {
    const s = signal(1);
    const doubled = computed(() => s.get() * 2);
    let seen = 0;
    let runs = 0;
    const dispose = effect(() => {
      seen = doubled.get();
      runs++;
    });
    expect(seen).toBe(2);
    expect(runs).toBe(1);
    s.set(5);
    flush();
    expect(seen).toBe(10);
    expect(runs).toBe(2);
    dispose();
  });

  it('computed depending on computed', () => {
    const s = signal(2);
    const doubled = computed(() => s.get() * 2);
    const quadrupled = computed(() => doubled.get() * 2);
    expect(quadrupled.get()).toBe(8);
    s.set(3);
    expect(quadrupled.get()).toBe(12);
  });

  it('does not recompute for an already-dirty computed when get() is not called', () => {
    let evalCount = 0;
    const s = signal(1);
    const c = computed(() => {
      evalCount++;
      return s.get();
    });
    c.get();
    expect(evalCount).toBe(1);
    s.set(2);
    s.set(3);
    // Not calling c.get() yet; two changes, still only one pending dirty.
    expect(evalCount).toBe(1);
    expect(c.get()).toBe(3);
    expect(evalCount).toBe(2); // one recompute for both mutations
  });
});

// ---------------------------------------------------------------------------
// batch()
// ---------------------------------------------------------------------------

describe('batch', () => {
  it('defers effect scheduling until fn completes', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      a.get();
      b.get();
      runs++;
    });
    expect(runs).toBe(1);
    batch(() => {
      a.set(1);
      b.set(2);
    });
    expect(runs).toBe(1); // still deferred
    flush();
    expect(runs).toBe(2); // one re-run
    dispose();
  });

  it('multiple set() calls inside batch produce exactly one flush', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    batch(() => {
      s.set(1);
      s.set(2);
      s.set(3);
    });
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('nested batch() calls flush only when outermost batch completes', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    expect(runs).toBe(1);
    batch(() => {
      batch(() => {
        s.set(1);
      });
      expect(runs).toBe(1); // inner batch done, outer still active
      s.set(2);
    });
    flush();
    expect(runs).toBe(2); // one re-run after outermost batch
    dispose();
  });
});

// ---------------------------------------------------------------------------
// scheduler flush()
// ---------------------------------------------------------------------------

describe('scheduler flush()', () => {
  it('synchronously executes all pending effects', () => {
    const s = signal(0);
    let seen = 0;
    const dispose = effect(() => {
      seen = s.get();
    });
    s.set(7);
    expect(seen).toBe(0); // not yet
    flush();
    expect(seen).toBe(7);
    dispose();
  });

  it('is safe to call when there are no pending effects', () => {
    expect(() => { flush(); }).not.toThrow();
  });

  it('does not run disposed effects', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });
    s.set(1);
    dispose(); // dispose before flush
    flush();
    expect(runs).toBe(1); // only the initial run
  });
});

// ---------------------------------------------------------------------------
// Signal and ReadonlySignal types are exported from types/index.ts
// (This is a compile-time check; if it builds, the types are present.)
// ---------------------------------------------------------------------------

describe('type exports', () => {
  it('Signal<T> and ReadonlySignal<T> satisfy their interfaces', () => {
    const s = signal('hello');
    // Signal<T> has get, set, update
    const value: string = s.get();
    s.set('world');
    s.update((v) => v.toUpperCase());
    expect(s.get()).toBe('WORLD');
    expect(value).toBe('hello');

    // ReadonlySignal<T> has only get
    const c = computed(() => s.get().length);
    const len: number = c.get();
    expect(len).toBe(5);
  });
});
