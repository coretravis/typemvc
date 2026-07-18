// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  transformTmvc,
  validateTmvcSource,
  extractLocalBlock,
} from '../../src/vite-plugin/index.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import { flush } from '../../src/reactivity/scheduler.js';
import {
  _callComponent,
  _setComponentRegistry,
} from '../../src/core/component-registry.js';
import type { ComponentFunction, ViewContext } from '../../src/types/index.js';

const COMPONENT_ID = '/src/components/Accordion.tmvc';
const VIEW_ID = '/src/views/home/index.tmvc';

function localSource(statement: string): string {
  return `@local {\n  ${statement}\n}\n<div></div>`;
}

function makeContext(data: Record<string, unknown> = {}): ViewContext {
  return {
    model: Object.create(null) as Record<string, unknown>,
    data,
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

// ---------------------------------------------------------------------------
// extractLocalBlock
// ---------------------------------------------------------------------------

describe('extractLocalBlock', () => {
  it('lifts the block, blanking the @local keyword and braces', () => {
    const block = extractLocalBlock('@local {\n  const a = 1;\n}\n<div></div>');
    expect(block).not.toBeNull();
    expect(block?.startLine).toBe(0);
    expect(block?.lineCount).toBe(3);
    expect(block?.statements).toContain('const a = 1;');
    expect(block?.statements).not.toContain('@local');
    expect(block?.statements).not.toContain('{');
    expect(block?.statements).not.toContain('}');
  });

  it('removes the block from the markup, preserving the rest', () => {
    const block = extractLocalBlock('@local {\n  const a = 1;\n}\n<div>hi</div>');
    expect(block?.markup).not.toContain('const a');
    expect(block?.markup).toContain('<div>hi</div>');
  });

  it('preserves the line count of the body in the markup', () => {
    const body = '@local {\n  const a = 1;\n}\n<div></div>';
    const block = extractLocalBlock(body);
    expect(block?.markup.split('\n').length).toBe(body.split('\n').length);
  });

  it('returns null when there is no block', () => {
    expect(extractLocalBlock('<div>${props.x}</div>')).toBeNull();
  });

  it('handles braces inside strings within the block', () => {
    const block = extractLocalBlock('@local {\n  const s = "}";\n}\n<div></div>');
    expect(block).not.toBeNull();
    expect(block?.statements).toContain('const s = "}";');
  });
});

// ---------------------------------------------------------------------------
// transformTmvc: lifting into the render body (AC1)
// ---------------------------------------------------------------------------

describe('transformTmvc with @local (AC1)', () => {
  const src =
    '@props { title: string }\n' +
    '@local {\n' +
    '  const open = signal(false);\n' +
    '  const toggle = () => open.update(v => !v);\n' +
    '}\n' +
    '<button onclick="${toggle}">${props.title}</button>';

  it('imports the reactivity primitives on the component import line', () => {
    const { code } = transformTmvc(src, COMPONENT_ID);
    expect(code).toContain(
      'import { html, svg, _callComponent, signal, computed, effect, batch, onCleanup, useForm, keyed, keyedMap, safeHtml, stop, prevent } ' +
        "from '@typemvc/core';",
    );
  });

  it('lifts the statements into the render body before return html', () => {
    const { code } = transformTmvc(src, COMPONENT_ID);
    expect(code).toContain('export default function render(props) {');
    expect(code).toContain('const open = signal(false);');
    const stmtIdx = code.indexOf('const open = signal(false);');
    const returnIdx = code.indexOf('return html`');
    expect(stmtIdx).toBeGreaterThan(-1);
    expect(stmtIdx).toBeLessThan(returnIdx);
  });

  it('strips the @props directive and the @local fences from the output', () => {
    const { code } = transformTmvc(src, COMPONENT_ID);
    expect(code).not.toContain('@props');
    expect(code).not.toContain('@local');
  });

  it('embeds the same statements that extractLocalBlock lifts (AC6 parity)', () => {
    const { code } = transformTmvc(src, COMPONENT_ID);
    const block = extractLocalBlock(
      '         \n' + // @props line, blanked by extractDirective in the real path
        '@local {\n  const open = signal(false);\n  const toggle = () => open.update(v => !v);\n}\n<button onclick="${toggle}">${props.title}</button>',
    );
    expect(block).not.toBeNull();
    if (block !== null) expect(code).toContain(block.statements.trim());
  });
});

// ---------------------------------------------------------------------------
// transformTmvc: components without @local are unchanged (AC8)
// ---------------------------------------------------------------------------

describe('transformTmvc without @local (AC8)', () => {
  it('keeps the original component preamble', () => {
    const { code } = transformTmvc('@props { x: number }\n<span>${props.x}</span>', '/src/components/Stat.tmvc');
    expect(code).toContain("import { html, svg, _callComponent, computed, keyed, keyedMap, safeHtml, stop, prevent } from '@typemvc/core';");
    expect(code).not.toContain('signal, computed, effect');
    expect(code).toContain('export default function render(props) {');
  });

  it('does not lift anything for a view path even if @local-like text appears in markup', () => {
    const { code } = transformTmvc('<p>plain</p>', VIEW_ID);
    expect(code).toContain('export default function render(context) {');
    expect(code).not.toContain('signal, computed, effect');
  });
});

// ---------------------------------------------------------------------------
// Validation: components only (AC3) and the denylist (AC4)
// ---------------------------------------------------------------------------

describe('@local validation', () => {
  it('flags @local in a view file (AC3)', () => {
    const errors = validateTmvcSource(localSource('const a = signal(0);'), VIEW_ID);
    expect(errors.some((e) => e.kind === 'local-in-view')).toBe(true);
  });

  it('does not flag @local in a component file', () => {
    const errors = validateTmvcSource(localSource('const a = signal(0);'), COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-in-view')).toBe(false);
  });

  it('accepts a normal block with no forbidden constructs', () => {
    const errors = validateTmvcSource(localSource('const open = signal(false);'), COMPONENT_ID);
    expect(errors).toHaveLength(0);
  });

  it('flags import inside the block (AC4)', () => {
    const errors = validateTmvcSource(localSource("import x from 'y';"), COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-import')).toBe(true);
    expect(errors.some((e) => e.kind === 'import-statement')).toBe(false);
  });

  it('flags export inside the block (AC4)', () => {
    const errors = validateTmvcSource(localSource('export const z = 1;'), COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-export')).toBe(true);
  });

  it('flags await inside the block (AC4)', () => {
    const errors = validateTmvcSource(localSource('const v = await thing();'), COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-async')).toBe(true);
  });

  it('flags async inside the block (AC4)', () => {
    const errors = validateTmvcSource(localSource('async function f() { return 1; }'), COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-async')).toBe(true);
  });

  it('flags fetch inside the block (AC4)', () => {
    const errors = validateTmvcSource(localSource("const r = fetch('/x');"), COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-fetch')).toBe(true);
  });

  it('without an id, skips the component check but keeps the denylist', () => {
    const errors = validateTmvcSource(localSource("import x from 'y';"));
    expect(errors.some((e) => e.kind === 'local-in-view')).toBe(false);
    expect(errors.some((e) => e.kind === 'local-import')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Source map (AC7)
// ---------------------------------------------------------------------------

describe('@local source map (AC7)', () => {
  it('maps the lifted block lines and preserves the original source', () => {
    const src = '@local {\n  const a = signal(0);\n}\n<div>${a.get()}</div>';
    const { map } = transformTmvc(src, COMPONENT_ID);
    const parsed = JSON.parse(map) as { mappings: string; sourcesContent: string[] };
    const parts = parsed.mappings.split(';');
    expect(parts[0]).toBe('');
    expect(parts[1]).toBe('');
    expect(parts[2]).toBe('');
    // Three block lines follow the three preamble lines, each mapped.
    expect(parts[3]).not.toBe('');
    expect(parts[4]).not.toBe('');
    expect(parts[5]).not.toBe('');
    expect(parsed.sourcesContent[0]).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Runtime behaviour through the zero-build parser (AC2, AC5)
// ---------------------------------------------------------------------------

describe('@local runtime behaviour via parseTmvc', () => {
  it('local state drives a reactive binding through an event handler (AC2)', () => {
    const fn = parseTmvc(
      '@local {\n' +
        '  const count = signal(0);\n' +
        '  const inc = () => count.update(n => n + 1);\n' +
        '}\n' +
        '<button onclick="${inc}">go</button><span>${count}</span>',
    );
    const frag = fn(makeContext());
    const container = document.createElement('div');
    container.append(...frag.nodes);
    const button = container.querySelector('button');
    const span = container.querySelector('span');

    expect(span?.textContent).toBe('0');
    button?.click();
    button?.click();
    button?.click();
    flush();
    // The block ran once: count persisted across updates rather than resetting (AC5).
    expect(span?.textContent).toBe('3');
  });

  it('computed local state stays reactive', () => {
    const fn = parseTmvc(
      '@local {\n' +
        '  const open = signal(false);\n' +
        '  const label = computed(() => open.get() ? "open" : "closed");\n' +
        '  const toggle = () => open.update(v => !v);\n' +
        '}\n' +
        '<button onclick="${toggle}">${label}</button>',
    );
    const frag = fn(makeContext());
    const container = document.createElement('div');
    container.append(...frag.nodes);
    const button = container.querySelector('button');

    expect(button?.textContent).toBe('closed');
    button?.click();
    flush();
    expect(button?.textContent).toBe('open');
  });

  it('onCleanup in a @local block runs when the component Fragment is disposed', () => {
    const onClean = vi.fn();
    const fn = parseTmvc('@local {\n  onCleanup(() => context.data.onClean());\n}\n<div>x</div>');
    _setComponentRegistry({ Widget: fn });

    const frag = _callComponent('Widget', { data: { onClean } });
    expect(onClean).not.toHaveBeenCalled();

    frag.dispose();
    expect(onClean).toHaveBeenCalledTimes(1);
  });
});
