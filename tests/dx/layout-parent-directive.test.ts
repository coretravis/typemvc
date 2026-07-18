// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractDirective,
  validateTmvcSource,
  transformTmvc,
  loadTmvcModule,
  describeValidationError,
} from '../../src/vite-plugin/index.js';
import { generateVirtualTs, getTmvcDiagnostics } from '../../src/volar-plugin/index.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import { assembleContext } from '../../src/core/context.js';
import type { IRouter, ViewContext } from '../../src/types/index.js';

const LAYOUT_ID = '/src/layouts/AdminLayout.tmvc';
const VIEW_ID = '/src/views/home/index.tmvc';
const COMPONENT_ID = '/src/components/Pill.tmvc';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeContext(): ViewContext {
  const router: IRouter = {
    navigateTo: () => { return; },
    replace: () => { return; },
    back: () => { return; },
    forward: () => { return; },
    current: '/',
  };
  return assembleContext(null, null, { action: null }, router, {}, new URLSearchParams(), {});
}

// ---------------------------------------------------------------------------
// Directive parsing
// ---------------------------------------------------------------------------

describe('extractDirective: @parent', () => {
  it('parses a @parent line and whites it out of the body', () => {
    const src = '@parent AppLayout\n<div class="admin">${context.slot}</div>';
    const { parent, body } = extractDirective(src);

    expect(parent?.name).toBe('AppLayout');
    expect(parent?.line).toBe(0);
    expect(body).not.toContain('@parent');
    expect(body.length).toBe(src.length);
    expect(body.split('\n').length).toBe(src.split('\n').length);
    expect(body.split('\n')[1]).toBe('<div class="admin">${context.slot}</div>');
  });

  it('returns a null parent when the directive is absent', () => {
    const { parent } = extractDirective('<div>${context.slot}</div>');
    expect(parent).toBeNull();
  });

  it('parses @parent alongside @use lines in the directive block', () => {
    const src =
      "@parent AppLayout\n@use { ICONS } from '../lib/icons'\n<nav>${ICONS.home}</nav>${context.slot}";
    const { parent, uses, body } = extractDirective(src);

    expect(parent?.name).toBe('AppLayout');
    expect(uses).toHaveLength(1);
    expect(uses[0]?.specifier).toBe('../lib/icons');
    expect(body).not.toContain('@parent');
    expect(body).not.toContain('@use');
  });

  it('parses a @use line that precedes @parent', () => {
    const src = "@use { ICONS } from '../lib/icons'\n@parent AppLayout\n<p>${ICONS.home}</p>";
    const { parent, uses } = extractDirective(src);

    expect(parent?.name).toBe('AppLayout');
    expect(uses).toHaveLength(1);
  });

  it('skips leading blank lines to find the directive', () => {
    const { parent } = extractDirective('\n\n@parent AppLayout\n<main>${context.slot}</main>');
    expect(parent?.name).toBe('AppLayout');
    expect(parent?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Placement and file kind rules
// ---------------------------------------------------------------------------

describe('validateTmvcSource: @parent placement', () => {
  it('accepts @parent in a layout file', () => {
    const errors = validateTmvcSource('@parent AppLayout\n<div>${context.slot}</div>', LAYOUT_ID);
    expect(errors).toHaveLength(0);
  });

  it('rejects @parent in a view file', () => {
    const errors = validateTmvcSource('@parent AppLayout\n<h1>Home</h1>', VIEW_ID);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('parent-outside-layout');
    expect(errors[0]?.line).toBe(1);
  });

  it('rejects @parent in a component file', () => {
    const errors = validateTmvcSource('@parent AppLayout\n<span>${props.label}</span>', COMPONENT_ID);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('parent-outside-layout');
  });

  it('rejects a second @parent directive', () => {
    const errors = validateTmvcSource(
      '@parent AppLayout\n@parent PortalLayout\n<div>${context.slot}</div>',
      LAYOUT_ID,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('invalid-parent-directive');
    expect(errors[0]?.line).toBe(2);
  });

  it('rejects @parent once markup has begun', () => {
    const errors = validateTmvcSource(
      '<div>${context.slot}</div>\n@parent AppLayout',
      LAYOUT_ID,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('invalid-parent-directive');
    expect(errors[0]?.line).toBe(2);
  });

  it('rejects @parent with no layout name', () => {
    const errors = validateTmvcSource('@parent\n<div>${context.slot}</div>', LAYOUT_ID);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('invalid-parent-directive');
  });

  it('does not flag @parent inside an HTML comment', () => {
    const errors = validateTmvcSource(
      '<div>${context.slot}</div>\n<!-- @parent AppLayout -->',
      LAYOUT_ID,
    );
    expect(errors).toHaveLength(0);
  });
});

describe('describeValidationError: @parent rules', () => {
  it('names the layouts-only rule', () => {
    const message = describeValidationError({
      kind: 'parent-outside-layout',
      line: 1,
      source: '@parent AppLayout',
    });
    expect(message).toContain('layout');
    expect(message).toContain('@parent');
  });

  it('names the placement rule', () => {
    const message = describeValidationError({
      kind: 'invalid-parent-directive',
      line: 2,
      source: '@parent AppLayout',
    });
    expect(message).toContain('directive block');
    expect(message).toContain('once');
  });
});

describe('loadTmvcModule: @parent errors', () => {
  it('throws a [TypeMVC] error naming the line for @parent in a view', () => {
    expect(() => loadTmvcModule('@parent AppLayout\n<h1>Home</h1>', VIEW_ID)).toThrow(
      /\[TypeMVC\].*line 1/s,
    );
  });

  it('throws for a duplicate @parent in a layout', () => {
    expect(() =>
      loadTmvcModule('@parent AppLayout\n@parent PortalLayout\n<div></div>', LAYOUT_ID),
    ).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// Generated module shape
// ---------------------------------------------------------------------------

describe('transformTmvc: @parent emits a named export', () => {
  it('emits the parent layout name as a named export', () => {
    const { code } = transformTmvc('@parent AppLayout\n<div>${context.slot}</div>', LAYOUT_ID);
    expect(code).toContain('export const parent = "AppLayout";');
  });

  it('emits no parent export when the directive is absent', () => {
    const { code } = transformTmvc('<div>${context.slot}</div>', LAYOUT_ID);
    expect(code).not.toContain('export const parent');
  });

  it('keeps the parent export on the core import line, so the preamble is unchanged', () => {
    const withParent = transformTmvc('@parent AppLayout\n<div>a</div>', LAYOUT_ID).code.split('\n');
    const without = transformTmvc('<div>a</div>', LAYOUT_ID).code.split('\n');

    expect(withParent[0]).toContain('export const parent');
    expect(withParent[0]).toContain("from '@typemvc/core'");
    // The template opens on the same generated line whether or not the layout
    // names a parent, which is what the source map's leading unmapped lines are
    // pinned to. The line the whited-out directive leaves behind is the first
    // line of the template body, not a preamble line.
    expect(without[3]?.startsWith('  return html`')).toBe(true);
    expect(withParent[3]?.startsWith('  return html`')).toBe(true);
    expect(withParent[4]).toBe('<div>a</div>`;');
  });

  it('keeps the directive out of the rendered markup', () => {
    const { code } = transformTmvc('@parent AppLayout\n<div>${context.slot}</div>', LAYOUT_ID);
    const markup = code.slice(code.indexOf('return html`'));
    expect(markup).not.toContain('@parent');
    expect(markup).toContain('<div>${context.slot}</div>');
  });

  it('emits the parent export and the @use imports together', () => {
    const { code } = transformTmvc(
      "@parent AppLayout\n@use { ICONS } from '../lib/icons'\n<nav>${ICONS.home}</nav>",
      LAYOUT_ID,
    );
    expect(code).toContain('export const parent = "AppLayout";');
    expect(code).toContain("import { ICONS } from '../lib/icons';");
  });
});

describe('source map: a @parent layout maps to its own lines', () => {
  it('has the same three unmapped preamble lines as a layout with no directive', () => {
    const { map } = transformTmvc('@parent AppLayout\n<div>${context.slot}</div>', LAYOUT_ID);
    const mappings = (JSON.parse(map) as { mappings: string }).mappings;
    expect(mappings.startsWith(';;;cAAA')).toBe(true);
  });

  it('maps each markup line to the source line it came from', () => {
    const source = '@parent AppLayout\n<div>\n  ${context.slot}\n</div>';
    const { map } = transformTmvc(source, LAYOUT_ID);
    const parsed = JSON.parse(map) as { mappings: string; sourcesContent: string[] };
    const segments = parsed.mappings.split(';');

    // Three unmapped preamble lines, then one segment per source line: the third
    // source line (the slot expression) is generated line 6.
    expect(segments.slice(0, 3)).toEqual(['', '', '']);
    expect(segments).toHaveLength(3 + source.split('\n').length);
    expect(segments[3]).toBe('cAAA');
    expect(segments[5]).toBe('AACA');
    expect(parsed.sourcesContent[0]).toBe(source);
  });
});

// ---------------------------------------------------------------------------
// Runtime parser
// ---------------------------------------------------------------------------

describe('parseTmvc: @parent line', () => {
  it('parses a source carrying a @parent directive', () => {
    expect(() => parseTmvc('@parent AppLayout\n<div>ok</div>')).not.toThrow();
  });

  it('renders the markup without the directive text', () => {
    const render = parseTmvc('@parent AppLayout\n<div>ok</div>');
    const fragment = render(makeContext());
    const html = fragment.nodes
      .map((n) => (n instanceof Element ? n.outerHTML : n.textContent ?? ''))
      .join('');

    expect(html).toContain('<div>ok</div>');
    expect(html).not.toContain('@parent');
  });
});

// ---------------------------------------------------------------------------
// Editor support
// ---------------------------------------------------------------------------

describe('language server: @parent', () => {
  it('keeps the directive out of the virtual TypeScript file', () => {
    const { code } = generateVirtualTs(
      '@parent AppLayout\n<div>${context.slot}</div>',
      LAYOUT_ID,
      null,
    );
    expect(code).not.toContain('@parent');
    expect(code).toContain('${context.slot}');
  });

  it('reports a @parent outside a layout as a diagnostic on its own line', () => {
    const diagnostics = getTmvcDiagnostics('@parent AppLayout\n<h1>Home</h1>', VIEW_ID);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBe(0);
    expect(diagnostics[0]?.message).toContain('[TypeMVC]');
    expect(diagnostics[0]?.message).toContain('layout');
  });

  it('reports no diagnostic for a layout that declares a parent', () => {
    expect(
      getTmvcDiagnostics('@parent AppLayout\n<div>${context.slot}</div>', LAYOUT_ID),
    ).toHaveLength(0);
  });
});

interface GrammarPattern {
  readonly include?: string;
  readonly match?: string;
  readonly captures?: Record<string, { readonly name: string }>;
}

interface Grammar {
  readonly patterns: readonly GrammarPattern[];
  readonly repository: Record<string, GrammarPattern>;
}

describe('syntax grammar: @parent', () => {
  const grammar = JSON.parse(
    readFileSync(
      join(__dirname, '../../extensions/tmvc-syntax/syntaxes/tmvc.tmLanguage.json'),
      'utf-8',
    ),
  ) as Grammar;

  it('defines a parent-directive rule', () => {
    expect(grammar.repository['parent-directive']).toBeDefined();
  });

  it('matches a @parent line and scopes the keyword and the layout name', () => {
    const rule = grammar.repository['parent-directive'];
    expect(rule?.match).toBeDefined();
    const regex = new RegExp(rule?.match ?? '');
    expect(regex.test('@parent AppLayout')).toBe(true);
    expect(regex.test('<p>@parent AppLayout</p>')).toBe(false);
    expect(rule?.captures?.['1']?.name).toContain('keyword.control');
    expect(rule?.captures?.['2']?.name).toContain('tmvc');
  });

  it('applies the rule before the HTML grammar claims the line', () => {
    const directiveIdx = grammar.patterns.findIndex((p) => p.include === '#parent-directive');
    const htmlIdx = grammar.patterns.findIndex((p) => p.include === 'text.html.basic');
    expect(directiveIdx).toBeGreaterThanOrEqual(0);
    expect(directiveIdx).toBeLessThan(htmlIdx);
  });
});

describe('file format documentation', () => {
  it('documents the @parent directive', () => {
    const doc = readFileSync(join(__dirname, '../../docs/tmvc-file-format.md'), 'utf-8');
    expect(doc).toContain('@parent');
  });
});
