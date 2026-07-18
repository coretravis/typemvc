// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  transformTmvc,
  rewriteLocalComponentTags,
} from '../../src/vite-plugin/index.js';
import { generateVirtualTs } from '../../src/volar-plugin/index.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { _setComponentRegistry } from '../../src/core/component-registry.js';
import type { ComponentFunction, ViewContext } from '../../src/types/index.js';

const VIEW_ID = '/src/views/home/index.tmvc';
const COMPONENT_ID = '/src/components/List.tmvc';

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

function mountFragment(nodes: readonly Node[]): HTMLElement {
  const container = document.createElement('div');
  container.append(...nodes);
  return container;
}

beforeEach(() => {
  flush();
});

afterEach(() => {
  _setComponentRegistry(Object.create(null) as Record<string, ComponentFunction>);
});

// ---------------------------------------------------------------------------
// View and component template scope
// ---------------------------------------------------------------------------

describe('view template scope', () => {
  it('imports computed and the output helpers, but not signal or effect', () => {
    const { code } = transformTmvc('<p>${computed(() => 1)}</p>', VIEW_ID);
    const importLine = code.split('\n')[0] ?? '';
    expect(importLine).toContain('computed');
    expect(importLine).toContain('svg');
    expect(importLine).toContain('keyed');
    expect(importLine).toContain('keyedMap');
    expect(importLine).toContain('safeHtml');
    expect(importLine).toContain('stop');
    expect(importLine).toContain('prevent');
    expect(importLine).not.toMatch(/\bsignal\b/);
    expect(importLine).not.toMatch(/\beffect\b/);
  });

  it('derives a reactive value from the model with computed', () => {
    const render = parseTmvc('<span>${computed(() => context.data.count.get() * 2)}</span>');
    const count = { get: () => 21 };
    const frag = render(makeContext({ count }));
    const host = mountFragment(frag.nodes);
    expect(host.querySelector('span')?.textContent).toBe('42');
  });

  it('renders trusted markup through safeHtml in a view', () => {
    const render = parseTmvc('<div>${safeHtml(context.data.markup)}</div>');
    const frag = render(makeContext({ markup: '<b>hi</b>' }));
    const host = mountFragment(frag.nodes);
    expect(host.querySelector('b')?.textContent).toBe('hi');
  });
});

describe('component template scope', () => {
  it('imports computed and the output helpers on the props preamble', () => {
    const { code } = transformTmvc('<p>${props.label}</p>', COMPONENT_ID);
    const importLine = code.split('\n')[0] ?? '';
    expect(importLine).toContain('computed');
    expect(importLine).toContain('keyed');
    expect(importLine).toContain('safeHtml');
    expect(importLine).toContain('svg');
    expect(importLine).not.toMatch(/\bsignal\b/);
    expect(importLine).not.toMatch(/\beffect\b/);
  });
});

// ---------------------------------------------------------------------------
// signal and effect stay out of a view (the diagnostic surface)
// ---------------------------------------------------------------------------

describe('signal and effect are not in view scope', () => {
  it('leaves signal and effect out of the runtime view module', () => {
    const { code } = transformTmvc('<p>hi</p>', VIEW_ID);
    const importLine = code.split('\n')[0] ?? '';
    expect(importLine).not.toMatch(/\bsignal\b/);
    expect(importLine).not.toMatch(/\beffect\b/);
  });

  it('leaves signal and effect out of the virtual file so their use is undefined', () => {
    const { code } = generateVirtualTs('<p>${signal(0)}</p>', 'src/views/home/index.tmvc', null);
    const valueImport = code.split('\n').find((l) => l.startsWith('import { html'));
    expect(valueImport).toBeDefined();
    expect(valueImport).not.toMatch(/\bsignal\b/);
    expect(valueImport).not.toMatch(/\beffect\b/);
    expect(valueImport).toContain('computed');
  });
});

// ---------------------------------------------------------------------------
// @local scope
// ---------------------------------------------------------------------------

describe('@local scope', () => {
  it('imports keyed, keyedMap, safeHtml, svg, stop and prevent alongside the state primitives', () => {
    const src = '@local {\n  const open = signal(false);\n}\n<div></div>';
    const { code } = transformTmvc(src, COMPONENT_ID);
    const importLine = code.split('\n')[0] ?? '';
    for (const name of [
      'signal',
      'effect',
      'batch',
      'onCleanup',
      'computed',
      'keyed',
      'keyedMap',
      'safeHtml',
      'svg',
      'stop',
      'prevent',
    ]) {
      expect(importLine).toContain(name);
    }
  });

  it('drives a keyed list built inside the block', () => {
    const render = parseTmvc(
      '@local {\n' +
        '  const ids = signal([1, 2]);\n' +
        '  const rows = computed(() => keyedMap(ids.get(), (id) => id, (id) => html`<li>${String(id)}</li>`));\n' +
        '  const add = () => ids.update((xs) => [...xs, 3]);\n' +
        '}\n' +
        '<ul>${rows}</ul><button onclick="${add}">add</button>',
    );
    const host = mountFragment(render(makeContext()).nodes);
    expect(host.querySelectorAll('li')).toHaveLength(2);
    host.querySelector('button')?.click();
    flush();
    expect(host.querySelectorAll('li')).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Component tags inside a @local block
// ---------------------------------------------------------------------------

describe('rewriteLocalComponentTags', () => {
  it('rewrites a tag inside an html literal', () => {
    const out = rewriteLocalComponentTags('const x = html`<Pill label="hi" />`;');
    expect(out).toContain("_callComponent('Pill', { label: \"hi\" })");
  });

  it('rewrites a tag inside an svg literal', () => {
    const out = rewriteLocalComponentTags('const x = svg`<Glyph name="star" />`;');
    expect(out).toContain("_callComponent('Glyph', { name: \"star\" })");
  });

  it('rewrites a tag in a nested html literal inside a map callback', () => {
    const out = rewriteLocalComponentTags(
      'const rows = items.map((i) => html`<li><Pill label="${i.name}" /></li>`);',
    );
    expect(out).toContain("_callComponent('Pill'");
    expect(out).toContain('label: i.name');
  });

  it('leaves a tag inside a string literal untouched', () => {
    const src = 'const s = "<Pill/>"; const t = \'<Pill/>\';';
    expect(rewriteLocalComponentTags(src)).toBe(src);
  });

  it('leaves a tag inside a line comment untouched', () => {
    const src = 'const x = 1; // <Pill/> is just prose';
    expect(rewriteLocalComponentTags(src)).toBe(src);
  });

  it('leaves a tag inside a block comment untouched', () => {
    const src = '/* renders <Pill/> */ const x = 1;';
    expect(rewriteLocalComponentTags(src)).toBe(src);
  });

  it('leaves a tag inside an untagged template literal untouched', () => {
    const src = 'const s = `<Pill/>`;';
    expect(rewriteLocalComponentTags(src)).toBe(src);
  });

  it('leaves a block with no component tags byte-identical', () => {
    const src = 'const open = signal(false);\nconst toggle = () => open.update((v) => !v);';
    expect(rewriteLocalComponentTags(src)).toBe(src);
  });

  it('preserves the line count when a multi-line tag collapses', () => {
    const src = 'const x = html`<Pill\n  label="hi"\n/>`;';
    const out = rewriteLocalComponentTags(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });
});

describe('a component tag in a @local block renders as a component', () => {
  function registerPill(): void {
    const pill = parseTmvc('<span class="pill">${context.label}</span>');
    _setComponentRegistry({ Pill: pill });
  }

  it('renders a single component tag written in the block', () => {
    registerPill();
    const render = parseTmvc(
      '@local {\n' +
        '  const badge = html`<Pill label="solo" />`;\n' +
        '}\n' +
        '<div>${badge}</div>',
    );
    const host = mountFragment(render(makeContext()).nodes);
    expect(host.querySelector('span.pill')?.textContent).toBe('solo');
  });

  it('renders component rows produced by a map inside the block', () => {
    registerPill();
    const render = parseTmvc(
      '@local {\n' +
        '  const names = signal(["a", "b"]);\n' +
        '  const rows = computed(() => names.get().map((n) => html`<li><Pill label="${n}" /></li>`));\n' +
        '}\n' +
        '<ul>${rows}</ul>',
    );
    const host = mountFragment(render(makeContext()).nodes);
    const pills = host.querySelectorAll('span.pill');
    expect([...pills].map((p) => p.textContent)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// The headline reactive list, end to end
// ---------------------------------------------------------------------------

describe('a reactive list of components', () => {
  function registerPill(): void {
    _setComponentRegistry({ Pill: parseTmvc('<span class="pill">${context.label}</span>') });
  }

  const listSource = (rowsExpr: string): string =>
    '@local {\n' +
    '  const items = signal([{ id: 1, name: "a" }, { id: 2, name: "b" }]);\n' +
    `  const rows = computed(() => ${rowsExpr});\n` +
    '  const push = () => items.update((xs) => [...xs, { id: 3, name: "c" }]);\n' +
    '}\n' +
    '<ul>${rows}</ul><button onclick="${push}">add</button>';

  it('renders and re-renders the unkeyed form, and nudges toward keyed()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerPill();
    const render = parseTmvc(
      listSource('items.get().map((i) => html`<li><Pill label="${i.name}" /></li>`)'),
    );
    const host = mountFragment(render(makeContext()).nodes);

    expect([...host.querySelectorAll('span.pill')].map((p) => p.textContent)).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('keyed(');

    host.querySelector('button')?.click();
    flush();
    expect([...host.querySelectorAll('span.pill')].map((p) => p.textContent)).toEqual([
      'a',
      'b',
      'c',
    ]);
    warn.mockRestore();
  });

  it('renders and re-renders the keyed form without a nudge', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerPill();
    const render = parseTmvc(
      listSource(
        'keyedMap(items.get(), (i) => i.id, (i) => html`<li><Pill label="${i.name}" /></li>`)',
      ),
    );
    const host = mountFragment(render(makeContext()).nodes);

    expect(host.querySelectorAll('span.pill')).toHaveLength(2);
    host.querySelector('button')?.click();
    flush();
    expect(host.querySelectorAll('span.pill')).toHaveLength(3);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Volar call-site checking inside @local
// ---------------------------------------------------------------------------

describe('call-site checking for a component tag inside @local', () => {
  const imports = new Map([['Pill', './Pill.tmvc']]);
  const src =
    '@local {\n' +
    '  const rows = props.items.map((i) => html`<Pill label="${i.name}" />`);\n' +
    '}\n' +
    '<ul>${rows}</ul>';

  it('imports the component and emits a typed check that keeps the loop variable', () => {
    const { code } = generateVirtualTs(src, 'src/components/List.tmvc', null, imports);
    expect(code).toContain("import __Cmp_Pill from './Pill.tmvc';");
    expect(code).toContain('__Cmp_Pill({ label: (i.name) })');
  });

  it('maps the checked prop expression back to its source range', () => {
    const { code, extraMappings } = generateVirtualTs(
      src,
      'src/components/List.tmvc',
      null,
      imports,
    );
    const mapping = extraMappings.find((m) => {
      const g = m.generatedOffsets[0] ?? 0;
      const s = m.sourceOffsets[0] ?? 0;
      const len = m.lengths[0] ?? 0;
      return code.slice(g, g + len) === 'i.name' && src.slice(s, s + len) === 'i.name';
    });
    expect(mapping).toBeDefined();
  });

  it('does not emit a check for a component named only in a string literal', () => {
    const stringOnly =
      '@local {\n  const s = "<Pill/>";\n}\n<div>${s}</div>';
    const { code } = generateVirtualTs(
      stringOnly,
      'src/components/List.tmvc',
      null,
      imports,
    );
    expect(code).not.toContain('__Cmp_Pill');
  });
});

// ---------------------------------------------------------------------------
// Source maps survive the @local component rewrite
// ---------------------------------------------------------------------------

describe('@local source map with a component tag', () => {
  it('keeps one mapped generated line per block line', () => {
    const src =
      '@local {\n' +
      '  const rows = html`<Pill label="hi" />`;\n' +
      '}\n' +
      '<div>${rows}</div>';
    const { map } = transformTmvc(src, COMPONENT_ID);
    const parsed = JSON.parse(map) as { mappings: string; sourcesContent: string[] };
    const parts = parsed.mappings.split(';');
    // Three preamble lines are unmapped, then three block lines are mapped.
    expect(parts[0]).toBe('');
    expect(parts[1]).toBe('');
    expect(parts[2]).toBe('');
    expect(parts[3]).not.toBe('');
    expect(parts[4]).not.toBe('');
    expect(parts[5]).not.toBe('');
    expect(parsed.sourcesContent[0]).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// The runtime parser mirrors the plugin
// ---------------------------------------------------------------------------

describe('the runtime parser mirrors the plugin scope and rewrite', () => {
  it('renders a component in a @local reactive list identically to the plugin path', () => {
    _setComponentRegistry({ Pill: parseTmvc('<span class="pill">${context.label}</span>') });
    const render = parseTmvc(
      '@local {\n' +
        '  const names = signal(["x", "y"]);\n' +
        '  const rows = computed(() => keyedMap(names.get(), (n) => n, (n) => html`<li><Pill label="${n}" /></li>`));\n' +
        '}\n' +
        '<ul>${rows}</ul>',
    );
    const host = mountFragment(render(makeContext()).nodes);
    expect([...host.querySelectorAll('span.pill')].map((p) => p.textContent)).toEqual(['x', 'y']);
  });

  it('makes svg reachable from a view', () => {
    const render = parseTmvc(
      '<svg viewBox="0 0 10 10">${svg`<circle cx="5" cy="5" r="4" />`}</svg>',
    );
    const host = mountFragment(render(makeContext()).nodes);
    expect(host.querySelector('circle')).not.toBeNull();
  });
});
