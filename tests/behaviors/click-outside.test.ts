// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clickOutside } from '../../src/behaviors/click-outside.js';
import { _withOwner } from '../../src/reactivity/signal.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import { renderComponent } from '../../src/testing/index.js';
import { flush } from '../../src/reactivity/scheduler.js';
import type { ViewContext } from '../../src/types/index.js';

beforeEach(() => {
  flush();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function pointerDown(target: EventTarget): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function makeContext(): ViewContext {
  return {
    model: Object.create(null) as Record<string, unknown>,
    data: {},
    errors: { action: null },
    router: {
      navigateTo: () => undefined,
      replace: () => undefined,
      back: () => undefined,
      forward: () => undefined,
      current: '/',
    },
    params: {},
    query: new URLSearchParams(),
    partial: () => {
      throw new Error('partial not configured');
    },
  };
}

describe('clickOutside: detection', () => {
  it('fires on a pointer press outside the element but not inside', () => {
    const panel = document.createElement('div');
    const inside = document.createElement('span');
    panel.appendChild(inside);
    const outside = document.createElement('button');
    document.body.append(panel, outside);

    const fn = vi.fn();
    clickOutside(panel, fn);

    pointerDown(inside);
    expect(fn).not.toHaveBeenCalled();

    pointerDown(outside);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses pointerdown, not click', () => {
    const panel = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(panel, outside);

    const fn = vi.fn();
    clickOutside(panel, fn);

    outside.dispatchEvent(new Event('click', { bubbles: true }));
    expect(fn).not.toHaveBeenCalled();

    pointerDown(outside);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the element has been removed from the document', () => {
    const panel = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(panel, outside);

    const fn = vi.fn();
    clickOutside(panel, fn);
    panel.remove();

    expect(() => {
      pointerDown(outside);
    }).not.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('clickOutside: disposal', () => {
  it('removes the listener on the returned dispose', () => {
    const panel = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(panel, outside);

    const fn = vi.fn();
    const dispose = clickOutside(panel, fn);
    dispose();
    pointerDown(outside);
    expect(fn).not.toHaveBeenCalled();
  });

  it('registers teardown with onCleanup so the owner scope disposes it', () => {
    const panel = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(panel, outside);

    const fn = vi.fn();
    const { disposes } = _withOwner(() => {
      clickOutside(panel, fn);
    });
    for (const dispose of disposes) dispose();
    pointerDown(outside);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('clickOutside: composes with a ref in a @local block', () => {
  it('binds to the ref-obtained element and tears down on unmount', () => {
    const fn = vi.fn();
    // The ref callback receives the mounted element, hands it to clickOutside,
    // and returns the dispose so the Fragment tears it down on unmount.
    const source =
      '@local {\n' +
      '  const bind = (el) => clickOutside(el, () => context.data.onOutside());\n' +
      '}\n' +
      '<div class="panel" ref="${bind}"><span class="inner">hi</span></div>';
    const render = parseTmvc(source);

    const component = (props: { onOutside: () => void }): ReturnType<typeof render> => {
      const ctx = makeContext();
      (ctx.data as Record<string, unknown>).onOutside = props.onOutside;
      return render(ctx);
    };

    const view = renderComponent(component, { onOutside: fn });
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    const inner = view.query('.inner');
    if (inner === null) throw new Error('inner element not found');
    pointerDown(inner);
    expect(fn).not.toHaveBeenCalled();

    pointerDown(outside);
    expect(fn).toHaveBeenCalledTimes(1);

    view.unmount();
    pointerDown(outside);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
