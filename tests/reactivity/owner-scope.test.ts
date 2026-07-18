import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal, effect, computed, onCleanup, _withOwner } from '../../src/reactivity/signal.js';
import type { ReadonlySignal } from '../../src/types/index.js';
import { flush } from '../../src/reactivity/scheduler.js';

beforeEach(() => {
  flush();
});

// ---------------------------------------------------------------------------
// _withOwner -- collection of effects and cleanups
// ---------------------------------------------------------------------------

describe('_withOwner', () => {
  it('collects effects created during the call and disposes them (AC1)', () => {
    const s = signal(0);
    let runs = 0;
    const { disposes } = _withOwner(() => {
      effect(() => {
        s.get();
        runs++;
      });
    });

    expect(runs).toBe(1);
    s.set(1);
    flush();
    expect(runs).toBe(2);

    for (const dispose of disposes) dispose();
    s.set(2);
    flush();
    expect(runs).toBe(2);
  });

  it('collects onCleanup callbacks registered during the call', () => {
    let cleaned = 0;
    const { disposes } = _withOwner(() => {
      onCleanup(() => {
        cleaned++;
      });
    });

    expect(cleaned).toBe(0);
    for (const dispose of disposes) dispose();
    expect(cleaned).toBe(1);
  });

  it('returns the function result as value', () => {
    const { value } = _withOwner(() => 42);
    expect(value).toBe(42);
  });

  it('restores the previous owner after the call so nested scopes are isolated (AC6)', () => {
    let innerCollected = 0;
    const outer = _withOwner(() => {
      const inner = _withOwner(() => {
        effect(() => {
          /* tracked by the inner owner only */
          void 0;
        });
      });
      innerCollected = inner.disposes.length;
      effect(() => {
        /* tracked by the outer owner */
        void 0;
      });
    });

    expect(innerCollected).toBe(1);
    expect(outer.disposes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Effects created outside an owner scope are unaffected (AC3)
// ---------------------------------------------------------------------------

describe('effects outside an owner scope (AC3)', () => {
  it('are not collected and behave normally', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.get();
      runs++;
    });

    s.set(1);
    flush();
    expect(runs).toBe(2);

    dispose();
    s.set(2);
    flush();
    expect(runs).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// onCleanup outside an owner scope (AC5)
// ---------------------------------------------------------------------------

describe('onCleanup outside an owner scope (AC5)', () => {
  it('is a no-op and warns in DEV', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* suppress */
    });
    let called = 0;
    onCleanup(() => {
      called++;
    });

    expect(called).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('onCleanup'));
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// A computed released with its owner scope stops tracking upstream
// ---------------------------------------------------------------------------

describe('computed owner scope disposal', () => {
  it('releases an abandoned computed from its upstream signal when the owner disposes', () => {
    const s = signal(0);
    let runs = 0;
    let derived!: ReadonlySignal<number>;

    const { disposes } = _withOwner(() => {
      derived = computed(() => {
        runs++;
        return s.get();
      });
    });

    // First read computes and subscribes the computed to s.
    expect(derived.get()).toBe(0);
    expect(runs).toBe(1);

    // Dispose the owner: the computed cuts its subscription to s.
    for (const dispose of disposes) dispose();

    // s changing no longer reaches the computed, so it is not marked dirty and a
    // later read returns its frozen value without recomputing.
    s.set(5);
    expect(derived.get()).toBe(0);
    expect(runs).toBe(1);
  });

  it('leaves a computed created outside any owner scope fully reactive', () => {
    const s = signal(1);
    let runs = 0;
    const derived = computed(() => {
      runs++;
      return s.get() * 2;
    });

    expect(derived.get()).toBe(2);
    s.set(3);
    expect(derived.get()).toBe(6);
    expect(runs).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Async onCleanup rejection is reported, not swallowed
// ---------------------------------------------------------------------------

describe('async onCleanup failure isolation', () => {
  it('reports a rejecting async cleanup rather than swallowing it', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* suppress */
    });

    const { disposes } = _withOwner(() => {
      onCleanup(() => Promise.reject(new Error('async cleanup boom')));
    });
    for (const dispose of disposes) dispose();

    // Let the rejection's catch handler run on the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
