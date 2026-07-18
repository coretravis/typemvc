// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal, effect, onCleanup } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { html } from '../../src/renderer/html.js';
import { keyed } from '../../src/renderer/keyed.js';
import { reconcile } from '../../src/renderer/reconciler.js';
import { _callComponent, _invokeComponent, _setComponentRegistry } from '../../src/core/component-registry.js';
import type { ComponentFunction } from '../../src/types/index.js';

function register(map: Record<string, ComponentFunction>): void {
  _setComponentRegistry(map);
}

beforeEach(() => {
  flush();
});

afterEach(() => {
  _setComponentRegistry(Object.create(null) as Record<string, ComponentFunction>);
});

// ---------------------------------------------------------------------------
// Owner scope wired through _callComponent
// ---------------------------------------------------------------------------

describe('_callComponent owner scope', () => {
  it('disposes an effect created in a component render when its Fragment is disposed (AC1)', () => {
    const s = signal(0);
    let runs = 0;
    register({
      Counter: () => {
        effect(() => {
          s.get();
          runs++;
        });
        return html`<div>counter</div>`;
      },
    });

    const frag = _callComponent('Counter', {});
    expect(runs).toBe(1);
    s.set(1);
    flush();
    expect(runs).toBe(2);

    frag.dispose();
    s.set(2);
    flush();
    expect(runs).toBe(2);
  });

  it('runs onCleanup callbacks in reverse registration order on dispose (AC2)', () => {
    const order: number[] = [];
    register({
      Widget: () => {
        onCleanup(() => {
          order.push(1);
        });
        onCleanup(() => {
          order.push(2);
        });
        onCleanup(() => {
          order.push(3);
        });
        return html`<div>w</div>`;
      },
    });

    const frag = _callComponent('Widget', {});
    expect(order).toEqual([]);

    frag.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  it('disposes a component used in a keyed list when its row is removed (AC4)', () => {
    const s = signal(0);
    let runs = 0;
    register({
      Row: () => {
        effect(() => {
          s.get();
          runs++;
        });
        return html`<li>row</li>`;
      },
    });

    const parent = document.createElement('ul');
    const end = document.createComment('end');
    parent.append(end);

    const rowA = _callComponent('Row', {});
    let map = reconcile(end, new Map(), [keyed('a', rowA), keyed('b', html`<li>b</li>`)]);
    expect(runs).toBe(1);
    s.set(1);
    flush();
    expect(runs).toBe(2);

    // Remove the row carrying the component. 054 disposes the keyed item
    // fragment, which is the component fragment, so its @local effect stops.
    map = reconcile(end, map, [keyed('b', html`<li>b</li>`)]);
    s.set(2);
    flush();
    expect(runs).toBe(2);
    expect(map.has('a')).toBe(false);
  });

  it('restores the parent owner after a nested component render (AC6)', () => {
    const s = signal(0);
    let outerRuns = 0;
    register({
      Inner: () => html`<span>inner</span>`,
      Outer: () => {
        // Nested render uses and restores its own owner. The effect created
        // afterwards must still be collected by Outer's owner.
        const inner = _callComponent('Inner', {});
        effect(() => {
          s.get();
          outerRuns++;
        });
        return html`<div>${inner}</div>`;
      },
    });

    const frag = _callComponent('Outer', {});
    s.set(1);
    flush();
    expect(outerRuns).toBe(2);

    frag.dispose();
    s.set(2);
    flush();
    expect(outerRuns).toBe(2);
  });

  it('runs a statically placed component onCleanup when the parent is disposed', () => {
    let cleaned = 0;
    register({
      Dropdown: () => {
        onCleanup(() => {
          cleaned++;
        });
        return html`<div>dd</div>`;
      },
    });

    const parent = html`<section>${_callComponent('Dropdown', {})}</section>`;
    expect(cleaned).toBe(0);

    parent.dispose();
    expect(cleaned).toBe(1);
  });

  it('disposes a nested component when the outer component Fragment is disposed', () => {
    const s = signal(0);
    let innerRuns = 0;
    register({
      Inner: () => {
        effect(() => {
          s.get();
          innerRuns++;
        });
        return html`<span>i</span>`;
      },
      Outer: () => html`<div>${_callComponent('Inner', {})}</div>`,
    });

    const frag = _callComponent('Outer', {});
    expect(innerRuns).toBe(1);
    s.set(1);
    flush();
    expect(innerRuns).toBe(2);

    frag.dispose();
    s.set(2);
    flush();
    expect(innerRuns).toBe(2);
  });

  it('tears a component down identically whether it is called by name or by function', () => {
    const s = signal(0);
    const record: { runs: number; cleaned: number } = { runs: 0, cleaned: 0 };
    const Panel: ComponentFunction = () => {
      effect(() => {
        s.get();
        record.runs += 1;
      });
      onCleanup(() => {
        record.cleaned += 1;
      });
      return html`<div>panel</div>`;
    };

    // Both entry points must produce the same dispose chain: the registry path a
    // compiled template takes, and the function path the testing helper takes.
    const chains = [_callComponent, _invokeComponent].map((call) => {
      register({ Panel });
      record.runs = 0;
      record.cleaned = 0;

      const frag = call === _callComponent ? _callComponent('Panel', {}) : _invokeComponent(Panel, {});
      const afterRender = { runs: record.runs, cleaned: record.cleaned };

      s.update((n) => n + 1);
      flush();
      const afterUpdate = { runs: record.runs, cleaned: record.cleaned };

      frag.dispose();
      const afterDispose = { runs: record.runs, cleaned: record.cleaned };

      s.update((n) => n + 1);
      flush();
      const afterDisposedUpdate = { runs: record.runs, cleaned: record.cleaned };

      return { afterRender, afterUpdate, afterDispose, afterDisposedUpdate };
    });

    expect(chains[0]).toEqual({
      afterRender: { runs: 1, cleaned: 0 },
      afterUpdate: { runs: 2, cleaned: 0 },
      afterDispose: { runs: 2, cleaned: 1 },
      afterDisposedUpdate: { runs: 2, cleaned: 1 },
    });
    expect(chains[1]).toEqual(chains[0]);
  });

  it('warns and returns an empty Fragment for an unregistered component', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* suppress */
    });
    register({});

    const frag = _callComponent('Missing', {});
    expect(frag.nodes).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    warn.mockRestore();
  });
});
