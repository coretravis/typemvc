// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transformTmvc } from '../../src/vite-plugin/index.js';
import { generateVirtualTs } from '../../src/volar-plugin/index.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { _setComponentRegistry } from '../../src/core/component-registry.js';
import type { ComponentFunction, ViewContext } from '../../src/types/index.js';

const VIEW_ID = '/src/views/home/index.tmvc';
const COMPONENT_ID = '/src/components/Dialog.tmvc';
const BEHAVIOR_NAMES = ['persisted', 'mediaQuery', 'hotkey', 'clickOutside'] as const;

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

beforeEach(() => {
  flush();
});

afterEach(() => {
  _setComponentRegistry(Object.create(null) as Record<string, ComponentFunction>);
});

describe('behaviors in the @local capability surface (Vite plugin)', () => {
  it('imports the four behaviours from the behaviors entry point in a @local module', () => {
    const src = '@local {\n  const open = signal(false);\n}\n<div></div>';
    const { code } = transformTmvc(src, COMPONENT_ID);
    const importLine = code.split('\n')[0] ?? '';
    for (const name of BEHAVIOR_NAMES) expect(importLine).toContain(name);
    expect(importLine).toContain("from '@typemvc/core/behaviors'");
  });

  it('keeps the preamble at three lines so the source map stays aligned', () => {
    const src =
      '@local {\n' +
      '  const rows = html`<span>hi</span>`;\n' +
      '}\n' +
      '<div>${rows}</div>';
    const { map } = transformTmvc(src, COMPONENT_ID);
    const parsed = JSON.parse(map) as { mappings: string };
    const parts = parsed.mappings.split(';');
    // Three unmapped preamble lines, then the mapped block lines.
    expect(parts[0]).toBe('');
    expect(parts[1]).toBe('');
    expect(parts[2]).toBe('');
    expect(parts[3]).not.toBe('');
  });

  it('does not import the behaviours into a view module', () => {
    const { code } = transformTmvc('<p>hi</p>', VIEW_ID);
    expect(code).not.toContain('@typemvc/core/behaviors');
  });
});

describe('behaviors in the @local capability surface (Volar virtual file)', () => {
  it('imports the four behaviours for a component @local block', () => {
    const src = '@local {\n  const open = signal(false);\n}\n<div></div>';
    const { code } = generateVirtualTs(src, COMPONENT_ID, null);
    for (const name of BEHAVIOR_NAMES) expect(code).toContain(name);
    expect(code).toContain("from '@typemvc/core/behaviors'");
  });

  it('leaves the behaviours out of a view so their use is an undefined name', () => {
    const { code } = generateVirtualTs('<p>${persisted("k", 0)}</p>', VIEW_ID, null);
    expect(code).not.toContain('@typemvc/core/behaviors');
  });
});

describe('behaviors in the @local runtime scope', () => {
  it('makes all four names callable inside a @local block', () => {
    const render = parseTmvc(
      '@local {\n' +
        '  const kinds = [typeof persisted, typeof mediaQuery, typeof hotkey, typeof clickOutside].join(",");\n' +
        '}\n' +
        '<p>${kinds}</p>',
    );
    const frag = render(makeContext());
    const host = document.createElement('div');
    host.append(...frag.nodes);
    expect(host.querySelector('p')?.textContent).toBe('function,function,function,function');
  });
});
