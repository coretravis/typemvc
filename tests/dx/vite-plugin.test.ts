/**
 * Tests for issue 022: .tmvc Vite plugin.
 *
 * Acceptance criteria verified here:
 *   AC1  Plugin is a standard Vite plugin (implements transform hook for .tmvc)
 *   AC2  Transformed output is valid TypeScript that the Phase 1 renderer executes
 *   AC3  Generated module implicitly receives context; default export matches ViewContext -> Fragment
 *   AC4  Source maps are emitted mapping generated TypeScript lines to .tmvc lines
 *   AC5  Stack traces point to .tmvc line numbers (verified by source map line mappings)
 *   AC6  HMR: handleHotUpdate returns affected modules for .tmvc files (no full-page reload)
 *   AC7  HMR preserves signal state: generated module is self-accepting (import.meta.hot)
 *   AC8  Production build tree-shakes HMR code (import.meta.hot guard)
 *   AC9  Integration tests: basic transform, expressions, nested html, source map accuracy, HMR cycle
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  typemvcPlugin,
  validateTmvcSource,
  transformTmvc,
  loadTmvcModule,
  extractDirective,
  toTmvcVirtualId,
  fromTmvcVirtualId,
  isTmvcVirtualId,
  toTmvcStylePath,
  fromTmvcStylePath,
} from '../../src/vite-plugin/index.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import type {
  TmvcPlugin,
  TmvcTransformResult,
  TmvcResolveContext,
  TmvcHotUpdateType,
} from '../../src/vite-plugin/index.js';

// ---------------------------------------------------------------------------
// Issue 044: @model directive extraction, whiteout, and validation
// ---------------------------------------------------------------------------

describe('044: extractDirective', () => {
  it('parses @model from Controller.action', () => {
    const { directive } = extractDirective(
      '@model from TodoController.detail\n<h1>hi</h1>',
    );
    expect(directive).toEqual({
      kind: 'model-from',
      controller: 'TodoController',
      action: 'detail',
    });
  });

  it('parses @model <raw type expression>', () => {
    const { directive } = extractDirective(
      "@model import('../models/Report').Report | Draft\n<h1>hi</h1>",
    );
    expect(directive).toEqual({
      kind: 'model-type',
      expr: "import('../models/Report').Report | Draft",
    });
  });

  it('parses @props <type expression>', () => {
    const { directive } = extractDirective(
      '@props { label: string; value: number }\n<span>${props.label}</span>',
    );
    expect(directive).toEqual({
      kind: 'props',
      expr: '{ label: string; value: number }',
    });
  });

  it('returns null directive and unchanged body when absent', () => {
    const src = '<h1>${context.model.x}</h1>';
    const { directive, body } = extractDirective(src);
    expect(directive).toBeNull();
    expect(body).toBe(src);
  });

  it('whites out the directive in place, preserving length and line count', () => {
    const src = '@model from TodoController.detail\n<main>x</main>';
    const { body } = extractDirective(src);
    expect(body.length).toBe(src.length);
    expect(body.split('\n').length).toBe(src.split('\n').length);
    expect(body.split('\n')[0]).toBe(' '.repeat('@model from TodoController.detail'.length));
    expect(body.split('\n')[1]).toBe('<main>x</main>');
  });

  it('whites out a @props directive too', () => {
    const src = '@props { a: number }\n<span>${props.a}</span>';
    const { body } = extractDirective(src);
    expect(body).not.toContain('@props');
    expect(body.split('\n')[1]).toBe('<span>${props.a}</span>');
  });

  it('skips leading blank lines to find the directive', () => {
    const { directive } = extractDirective(
      '\n\n@model from FooController.bar\n<p></p>',
    );
    expect(directive).toEqual({ kind: 'model-from', controller: 'FooController', action: 'bar' });
  });

  it('extracts a multi-line @props block as one directive (issue 061)', () => {
    const src = '@props {\n  id: string;\n  title: string;\n}\n<span>${props.title}</span>';
    const { directive, body } = extractDirective(src);
    expect(directive).toEqual({ kind: 'props', expr: '{\n  id: string;\n  title: string;\n}' });
    expect(body.split('\n').length).toBe(src.split('\n').length);
    expect(body.length).toBe(src.length);
    expect(body.split('\n')[4]).toBe('<span>${props.title}</span>');
    expect(body).not.toContain('@props');
    expect(body).not.toContain('id: string');
  });

  it('extracts a multi-line @model type block', () => {
    const { directive } = extractDirective('@model {\n  a: number;\n}\n<p>${context.model.a}</p>');
    expect(directive).toEqual({ kind: 'model-type', expr: '{\n  a: number;\n}' });
  });
});

describe('044: transformTmvc strips the directive from runtime output', () => {
  it('runtime code contains no @model text', () => {
    const { code } = transformTmvc(
      '@model from TodoController.detail\n<h1>${context.model.text}</h1>',
      '/src/views/todo/detail.tmvc',
    );
    expect(code).not.toContain('@model');
    expect(code).toContain('context.model.text');
  });

  it('source map still embeds the original source including the directive', () => {
    const src = '@model from TodoController.detail\n<h1>x</h1>';
    const { map } = transformTmvc(src, '/src/views/todo/detail.tmvc');
    const parsed = JSON.parse(map) as { sourcesContent: string[] };
    expect(parsed.sourcesContent[0]).toBe(src);
  });

  it('renders identically to the same view without the directive (modulo blanks)', () => {
    const directiveLine = '@model from TodoController.detail';
    const withDirective = transformTmvc(
      `${directiveLine}\n<h1>\${context.model.text}</h1>`,
      '/src/views/todo/detail.tmvc',
    ).code;
    const without = transformTmvc(
      `${' '.repeat(directiveLine.length)}\n<h1>\${context.model.text}</h1>`,
      '/src/views/todo/detail.tmvc',
    ).code;
    expect(withDirective).toBe(without);
  });
});

describe('044: validateTmvcSource flags misplaced @model', () => {
  it('accepts @model on the first non-blank line', () => {
    const errors = validateTmvcSource('@model from TodoController.detail\n<h1>x</h1>');
    expect(errors.filter((e) => e.kind === 'invalid-model-directive')).toHaveLength(0);
  });

  it('flags @model that is not the first non-blank line', () => {
    const errors = validateTmvcSource('<h1>x</h1>\n@model from TodoController.detail');
    const dir = errors.filter((e) => e.kind === 'invalid-model-directive');
    expect(dir).toHaveLength(1);
    expect(dir[0]?.line).toBe(2);
  });

  it('flags a duplicate @model', () => {
    const errors = validateTmvcSource(
      '@model from A.b\n@model from C.d\n<p></p>',
    );
    expect(errors.filter((e) => e.kind === 'invalid-model-directive')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SourceMap {
  version: number;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

function parseMap(result: TmvcTransformResult): SourceMap {
  const parsed: unknown = JSON.parse(result.map);
  return parsed as SourceMap;
}

// ---------------------------------------------------------------------------
// AC1: Plugin is a standard Vite plugin
// ---------------------------------------------------------------------------

describe('AC1: plugin structure', () => {
  it('typemvcPlugin() returns an object', () => {
    expect(typeof typemvcPlugin()).toBe('object');
  });

  it('plugin name is "typemvc"', () => {
    expect(typemvcPlugin().name).toBe('typemvc');
  });

  it('plugin enforce is "pre"', () => {
    expect(typemvcPlugin().enforce).toBe('pre');
  });

  it('plugin has resolveId and load functions', () => {
    expect(typeof typemvcPlugin().resolveId).toBe('function');
    expect(typeof typemvcPlugin().load).toBe('function');
  });

  it('plugin has a handleHotUpdate function', () => {
    expect(typeof typemvcPlugin().handleHotUpdate).toBe('function');
  });

  it('handleHotUpdate returns the virtual module for an edited .tmvc', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const virtualModule = { id: '/src/components/Card.tmvc.ts' };
    const result = plugin.handleHotUpdate({
      file: '/src/components/Card.tmvc',
      modules: [],
      server: {
        moduleGraph: {
          getModuleById: (id: string) => (id === '/src/components/Card.tmvc.ts' ? virtualModule : undefined),
        },
      },
    });
    expect(result).toEqual([virtualModule]);
  });

  it('handleHotUpdate ignores files that are not .tmvc', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = plugin.handleHotUpdate({ file: '/src/main.ts', modules: [] });
    expect(result).toBeUndefined();
  });

  it('resolveId returns null for non-.tmvc specifiers', async () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const ctx: TmvcResolveContext = {
      resolve: () => Promise.resolve({ id: '/abs/x' }),
    };
    expect(await plugin.resolveId.call(ctx, 'views/index.html', undefined)).toBeNull();
    expect(await plugin.resolveId.call(ctx, 'views/index.ts', undefined)).toBeNull();
    expect(await plugin.resolveId.call(ctx, 'views/index.tsx', undefined)).toBeNull();
  });

  it('load returns null for a non-virtual id', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const ctx = { addWatchFile: (): void => undefined };
    expect(plugin.load.call(ctx, '/views/index.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TypeScript virtual-id pipeline (issue 065)
// ---------------------------------------------------------------------------

describe('tmvc virtual id', () => {
  it('wraps a real .tmvc path in a .ts virtual id', () => {
    const virtual = toTmvcVirtualId('/src/views/home.tmvc');
    expect(virtual).toBe('/src/views/home.tmvc.ts');
    expect(isTmvcVirtualId(virtual)).toBe(true);
    expect(virtual.endsWith('.ts')).toBe(true);
  });

  // Vite's esbuild pass decides what to transform with rollup's createFilter,
  // which rejects any id containing a NUL: `if (id.includes('\0')) return false`.
  // A NUL-prefixed virtual id therefore never reaches esbuild, its type
  // annotations are never stripped, and the next plugin to parse the module as
  // JavaScript fails on the first annotation. The id must stay NUL-free.
  it('produces an id esbuild will accept, with no NUL', () => {
    const virtual = toTmvcVirtualId('/src/components/Counter.tmvc');
    expect(virtual.includes('\0')).toBe(false);
    expect(/\.(m?ts|[jt]sx)$/.test(virtual)).toBe(true);
  });

  it('round-trips the real path out of the virtual id', () => {
    const real = '/src/components/Card.tmvc';
    expect(fromTmvcVirtualId(toTmvcVirtualId(real))).toBe(real);
  });

  it('fromTmvcVirtualId returns null for a plain id', () => {
    expect(fromTmvcVirtualId('/src/views/home.tmvc')).toBeNull();
    expect(fromTmvcVirtualId('/src/views/home.ts')).toBeNull();
  });

  it('resolveId maps a resolved .tmvc path to its virtual id', async () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const ctx: TmvcResolveContext = {
      resolve: () => Promise.resolve({ id: '/abs/src/views/home.tmvc' }),
    };
    const id = await plugin.resolveId.call(ctx, './home.tmvc', '/abs/src/views/index.ts');
    expect(id).toBe('/abs/src/views/home.tmvc.ts');
  });

  it('resolveId is idempotent for a virtual id it already produced', async () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const ctx: TmvcResolveContext = {
      resolve: (source: string) => Promise.resolve({ id: source }),
    };
    const virtual = toTmvcVirtualId('/abs/x.tmvc');
    expect(await plugin.resolveId.call(ctx, virtual, undefined)).toBe(virtual);
  });

  // Vite serves a module inside the project root under a ROOT-RELATIVE url, and
  // hands that url back to resolveId on the next request. Returning it verbatim
  // leaves `load` reading `/src/...` against the filesystem root, which on
  // Windows is `C:\src\...` and does not exist. The virtual id must be reduced
  // to its real `.tmvc` path and resolved to an absolute one again.
  it('resolveId re-resolves a root-relative virtual id to an absolute one', async () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const ctx: TmvcResolveContext = {
      resolve: (source: string) => Promise.resolve({ id: '/project' + source }),
    };
    const id = await plugin.resolveId.call(ctx, '/src/components/Card.tmvc.ts', undefined);
    expect(id).toBe('/project/src/components/Card.tmvc.ts');
  });

  it('resolveId returns null when the specifier does not resolve', async () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const ctx: TmvcResolveContext = {
      resolve: () => Promise.resolve(null),
    };
    expect(await plugin.resolveId.call(ctx, './missing.tmvc', '/abs/x.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC3: Transformed output is valid TypeScript; context is implicit
// ---------------------------------------------------------------------------

describe('AC2 + AC3: generated module shape', () => {
  it('output contains the html and _callComponent import from typemvc', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).toContain("import { html, svg, _callComponent, computed, keyed, keyedMap, safeHtml, stop, prevent } from '@typemvc/core';");
  });

  it('output contains no TypeScript-only import type statements (browser-safe)', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).not.toContain('import type');
  });

  it('output has default export render function', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).toContain('export default function render(');
  });

  it('render function accepts context parameter with no TypeScript annotations', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).toContain('function render(context)');
    expect(code).not.toContain('context: ViewContext');
  });

  it('context parameter is implicit (not declared inside .tmvc content)', () => {
    const source = '<p>${context.data.title}</p>';
    const { code } = transformTmvc(source, 'views/title.tmvc');
    // The generated code wraps the source; context comes from the parameter
    expect(code).toContain('function render(context)');
    expect(code).toContain('${context.data.title}');
    // context is NOT declared again inside the template
    const templateBodyStart = code.indexOf('return html`') + 12;
    const templateBody = code.slice(templateBodyStart);
    expect(templateBody).not.toMatch(/^\s*const context/m);
  });

  it('source content is placed verbatim inside the html tagged template', () => {
    const source = '<h1>Users</h1>\n<ul></ul>';
    const { code } = transformTmvc(source, 'views/users.tmvc');
    expect(code).toContain('<h1>Users</h1>');
    expect(code).toContain('<ul></ul>');
  });

  it('loadTmvcModule produces the module for a .tmvc file', () => {
    const result = loadTmvcModule('<p>Hello</p>', 'views/hello.tmvc');
    expect(result.code).toContain('export default function render');
  });
});

// ---------------------------------------------------------------------------
// AC4 + AC5: Source maps
// ---------------------------------------------------------------------------

describe('AC4 + AC5: source map accuracy', () => {
  it('transformTmvc returns a non-empty map string', () => {
    const result = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(typeof result.map).toBe('string');
    expect(result.map.length).toBeGreaterThan(0);
  });

  it('source map is valid JSON', () => {
    const result = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(() => { JSON.parse(result.map); }).not.toThrow();
  });

  it('source map has version 3', () => {
    const result = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(parseMap(result).version).toBe(3);
  });

  it('source map sources array contains the file id', () => {
    const id = 'views/users/index.tmvc';
    const result = transformTmvc('<h1>Users</h1>', id);
    expect(parseMap(result).sources).toContain(id);
  });

  it('source map sourcesContent contains the original source', () => {
    const source = '<h1>Users</h1>';
    const result = transformTmvc(source, 'views/hello.tmvc');
    expect(parseMap(result).sourcesContent).toContain(source);
  });

  it('source map has 3 empty preamble entries before first source mapping', () => {
    const result = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    const { mappings } = parseMap(result);
    // Three leading semicolons = three empty preamble line mappings
    expect(mappings.startsWith(';;;')).toBe(true);
  });

  it('source map first content segment encodes generated column 14 (cAAA)', () => {
    const result = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    const { mappings } = parseMap(result);
    // After five semicolons, the first segment should be cAAA
    // cAAA = col 14, src file 0, src line 0, src col 0
    expect(mappings).toContain(';cAAA');
  });

  it('multi-line source: each subsequent line uses delta-1 source-line segment (AACA)', () => {
    const source = '<h1>Line 1</h1>\n<p>Line 2</p>\n<span>Line 3</span>';
    const result = transformTmvc(source, 'views/multi.tmvc');
    const { mappings } = parseMap(result);
    // Should have cAAA for first line and AACA for subsequent lines
    expect(mappings).toContain(';cAAA;AACA;AACA');
  });

  it('empty source produces only preamble mappings', () => {
    const result = transformTmvc('', 'views/empty.tmvc');
    const { mappings } = parseMap(result);
    // With 1 line from ''.split('\n') = [''], we get 3 empty + cAAA
    expect(mappings.startsWith(';;;')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC6 + AC7: HMR update cycle
// ---------------------------------------------------------------------------

describe('AC6: HMR handleHotUpdate', () => {
  it('returns undefined for non-.tmvc files', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const fakeModules = [{ id: 'views/index.ts' }];
    const result = plugin.handleHotUpdate({
      file: '/project/views/index.ts',
      modules: fakeModules,
    });
    expect(result).toBeUndefined();
  });

  it('returns the modules array for .tmvc files', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const fakeModules = [{ id: 'views/index.tmvc' }, { id: 'another' }];
    const result = plugin.handleHotUpdate({
      file: '/project/views/index.tmvc',
      modules: fakeModules,
    });
    expect(result).toBe(fakeModules);
  });

  it('returns the full modules array (not filtered)', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const fakeModules = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = plugin.handleHotUpdate({
      file: '/project/views/page.tmvc',
      modules: fakeModules,
    });
    expect(result).toHaveLength(3);
  });
});

describe('AC7 + AC8: HMR self-accept and tree-shaking', () => {
  it('generated module contains import.meta.hot check', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).toContain('import.meta.hot');
  });

  it('generated module calls import.meta.hot.accept()', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).toContain('import.meta.hot.accept()');
  });

  it('HMR code is guarded by if (import.meta.hot) for tree-shaking', () => {
    const { code } = transformTmvc('<p>Hello</p>', 'views/hello.tmvc');
    expect(code).toContain('if (import.meta.hot)');
  });
});

// ---------------------------------------------------------------------------
// validateTmvcSource: forbidden construct detection
// ---------------------------------------------------------------------------

describe('validateTmvcSource: import-statement', () => {
  it('returns no errors for valid source', () => {
    const source = '<h1>Hello</h1>\n<p>${context.data.msg}</p>';
    expect(validateTmvcSource(source)).toHaveLength(0);
  });

  it('detects import statement at start of line', () => {
    const errors = validateTmvcSource("import { foo } from 'bar';\n<p>hi</p>");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('import-statement');
  });

  it('detects import with leading whitespace', () => {
    const errors = validateTmvcSource("  import x from 'y';");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('import-statement');
  });

  it('reports the correct 1-based line number for import', () => {
    const errors = validateTmvcSource("<p>ok</p>\nimport x from 'y';");
    expect(errors[0]?.line).toBe(2);
  });

  it('reports the source text of the offending import line', () => {
    const source = "import x from 'y';";
    const errors = validateTmvcSource(source);
    expect(errors[0]?.source).toBe(source);
  });
});

describe('validateTmvcSource: export-statement', () => {
  it('detects export statement', () => {
    const errors = validateTmvcSource('export const x = 1;');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('export-statement');
  });

  it('detects export default', () => {
    const errors = validateTmvcSource('export default function foo() {}');
    expect(errors[0]?.kind).toBe('export-statement');
  });

  it('reports the correct line number for export', () => {
    const errors = validateTmvcSource('<p>ok</p>\n<div>ok</div>\nexport const y = 2;');
    expect(errors[0]?.line).toBe(3);
  });
});

describe('validateTmvcSource: class-definition', () => {
  it('detects class definition', () => {
    const errors = validateTmvcSource('class Foo {}');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('class-definition');
  });

  it('detects abstract class definition', () => {
    const errors = validateTmvcSource('abstract class Bar {}');
    expect(errors[0]?.kind).toBe('class-definition');
  });

  it('reports correct line number for class', () => {
    const errors = validateTmvcSource('<h1>ok</h1>\nclass Foo {}');
    expect(errors[0]?.line).toBe(2);
  });
});

describe('validateTmvcSource: expression context does not trigger false positives', () => {
  it('import inside ${...} expression is not flagged', () => {
    // Dynamic import inside an expression is valid TypeScript
    const source = "<p>${context.data.x}</p>\n${import('foo').then(m => m.default)}";
    const errors = validateTmvcSource(source);
    expect(errors).toHaveLength(0);
  });

  it('export-like text inside a string expression is not flagged', () => {
    const source = "<p>${'export this text'}</p>";
    const errors = validateTmvcSource(source);
    expect(errors).toHaveLength(0);
  });

  it('class inside a ${...} expression is not flagged', () => {
    const source = '<p>${new (class Foo { val = 1 })().val}</p>';
    const errors = validateTmvcSource(source);
    expect(errors).toHaveLength(0);
  });

  it('nested template literal with ${...} inside expression is not flagged', () => {
    const source =
      "<ul>${context.data.items.map(i => html`<li>${i.name}</li>`)}</ul>";
    const errors = validateTmvcSource(source);
    expect(errors).toHaveLength(0);
  });

  it('multi-line expression spanning lines does not flag inner lines', () => {
    const source =
      '${context.data.users.map(u => {\n  return u.name;\n})}\n<p>ok</p>';
    const errors = validateTmvcSource(source);
    expect(errors).toHaveLength(0);
  });
});

describe('validateTmvcSource: multiple errors collected', () => {
  it('collects all errors (does not short-circuit after first)', () => {
    const source = "import x from 'y';\nexport const z = 1;\nclass Foo {}";
    const errors = validateTmvcSource(source);
    expect(errors).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// AC9: Integration tests
// ---------------------------------------------------------------------------

describe('AC9: integration - basic transform', () => {
  it('minimal .tmvc file produces a complete module', () => {
    const source = '<p>Hello</p>';
    const { code } = transformTmvc(source, 'views/hello.tmvc');
    expect(code).toContain("import { html, svg, _callComponent, computed, keyed, keyedMap, safeHtml, stop, prevent } from '@typemvc/core';");
    expect(code).toContain('export default function render(context) {');
    expect(code).toContain('<p>Hello</p>');
    expect(code).toContain('`;\n}');
  });
});

describe('AC9: integration - expressions', () => {
  it('TypeScript expressions are preserved verbatim in the output', () => {
    const source = '<h1>${context.data.title}</h1>';
    const { code } = transformTmvc(source, 'views/title.tmvc');
    expect(code).toContain('${context.data.title}');
  });

  it('ternary expression is preserved verbatim', () => {
    const source =
      '${context.errors.name ? html`<span>${context.errors.name}</span>` : \'\'}';
    const { code } = transformTmvc(source, 'views/form.tmvc');
    expect(code).toContain('context.errors.name ? html`');
  });
});

describe('AC9: integration - nested html calls', () => {
  it('nested html tagged template calls are preserved verbatim', () => {
    const source =
      "<ul>${context.data.users.map(user => html`<li>${user.name}</li>`)}</ul>";
    const { code } = transformTmvc(source, 'views/users.tmvc');
    expect(code).toContain('html`<li>${user.name}</li>`');
  });

  it('deeply nested html expressions are preserved', () => {
    const source =
      '${context.data.sections.map(s => html`<section>${s.items.map(i => html`<p>${i}</p>`)}</section>`)}';
    const { code } = transformTmvc(source, 'views/nested.tmvc');
    expect(code).toContain("html`<p>${i}</p>`");
  });
});

describe('component prop spread', () => {
  it('rewrites ...${obj} to an object spread', () => {
    const { code } = transformTmvc('<BookCard ...${book} />', 'views/x.tmvc');
    expect(code).toContain("_callComponent('BookCard', { ...(book) })");
  });

  it('combines spread with explicit props in source order', () => {
    const { code } = transformTmvc('<BookCard ...${book} id="${x}" />', 'views/x.tmvc');
    expect(code).toContain("_callComponent('BookCard', { ...(book), id: x })");
  });

  it('rejects a malformed spread with no expression', () => {
    // `...` not followed by ${...} is not a valid spread; the tag is left as-is.
    const { code } = transformTmvc('<BookCard ...book />', 'views/x.tmvc');
    expect(code).not.toContain("_callComponent('BookCard'");
    expect(code).toContain('<BookCard ...book />');
  });
});

describe('AC9: integration - backtick escaping in markup', () => {
  it('bare backtick in markup text is escaped', () => {
    const source = '<code>`backtick`</code>';
    const { code } = transformTmvc(source, 'views/code.tmvc');
    // The backticks are in markup text and must be escaped
    expect(code).toContain('<code>\\`backtick\\`</code>');
  });

  it('backtick inside ${...} expression is NOT escaped', () => {
    const source = '${html`<span>ok</span>`}';
    const { code } = transformTmvc(source, 'views/ok.tmvc');
    // The backtick is inside the expression (template literal), not escaped
    expect(code).toContain('html`<span>ok</span>`');
    expect(code).not.toContain('html\\`<span>');
  });
});

describe('AC9: integration - source map accuracy', () => {
  it('source map file field matches the id argument', () => {
    const id = 'views/users/index.tmvc';
    const result = transformTmvc('<h1>Users</h1>', id);
    expect(parseMap(result).file).toBe(id);
  });

  it('source map sourcesContent preserves original source exactly', () => {
    const source = '<h1>Users</h1>\n<ul></ul>';
    const result = transformTmvc(source, 'views/users.tmvc');
    expect(parseMap(result).sourcesContent[0]).toBe(source);
  });

  it('source map has exactly the right number of segments for a 3-line source', () => {
    const source = 'line1\nline2\nline3';
    const result = transformTmvc(source, 'views/test.tmvc');
    const { mappings } = parseMap(result);
    const parts = mappings.split(';');
    // 3 empty preamble + 3 source lines = 6 segments minimum
    expect(parts.length).toBeGreaterThanOrEqual(6);
    expect(parts[0]).toBe('');
    expect(parts[1]).toBe('');
    expect(parts[2]).toBe('');
    expect(parts[3]).toBe('cAAA'); // first source line
    expect(parts[4]).toBe('AACA'); // second source line
    expect(parts[5]).toBe('AACA'); // third source line
  });
});

describe('AC9: integration - HMR update cycle', () => {
  it('loadTmvcModule returns code and map for .tmvc files', () => {
    const result = loadTmvcModule('<h1>Hello</h1>', '/project/views/hello.tmvc');
    expect(typeof result.code).toBe('string');
    expect(typeof result.map).toBe('string');
  });

  it('loadTmvcModule throws [TypeMVC] error for invalid .tmvc files', () => {
    expect(() =>
      loadTmvcModule("import x from 'y';", '/views/bad.tmvc'),
    ).toThrow('[TypeMVC]');
  });

  it('loadTmvcModule throws error with line number for invalid .tmvc', () => {
    expect(() =>
      loadTmvcModule("<p>ok</p>\nexport const x = 1;", '/views/bad.tmvc'),
    ).toThrow('line 2');
  });

  it('handleHotUpdate for .tmvc returns modules enabling module-level HMR', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const modules = [{ id: 'views/index.tmvc' }];
    const result = plugin.handleHotUpdate({
      file: '/project/views/index.tmvc',
      modules,
    });
    // Returning modules triggers a module-level HMR update (no full page reload)
    expect(result).not.toBeUndefined();
    expect(result).toBe(modules);
  });

  it('handleHotUpdate returns undefined for unrelated files (no interference)', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = plugin.handleHotUpdate({
      file: '/project/src/controller.ts',
      modules: [],
    });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Co-located stylesheets: Name.tmvc.css
// ---------------------------------------------------------------------------

describe('sibling stylesheet paths', () => {
  it('appends .css to a .tmvc path', () => {
    expect(toTmvcStylePath('/src/components/Pill.tmvc')).toBe('/src/components/Pill.tmvc.css');
  });

  it('recovers the .tmvc path a stylesheet styles', () => {
    expect(fromTmvcStylePath('/src/components/Pill.tmvc.css')).toBe('/src/components/Pill.tmvc');
  });

  it('returns null for a stylesheet that is not a sibling of a .tmvc file', () => {
    expect(fromTmvcStylePath('/src/styles/tokens.css')).toBeNull();
    expect(fromTmvcStylePath('/src/components/Pill.css')).toBeNull();
    expect(fromTmvcStylePath('/src/components/Pill.tmvc')).toBeNull();
  });

  it('does not mistake a stylesheet for a virtual module id', () => {
    expect(isTmvcVirtualId('/src/components/Pill.tmvc.css')).toBe(false);
    expect(fromTmvcVirtualId('/src/components/Pill.tmvc.css')).toBeNull();
  });
});

describe('a document with a sibling stylesheet imports it', () => {
  it('emits the import for a component', () => {
    const { code } = transformTmvc('<span class="pill">x</span>', '/src/components/Pill.tmvc', true);
    expect(code).toContain('import "./Pill.tmvc.css";');
  });

  it('emits the import for a view', () => {
    const { code } = transformTmvc('<main>x</main>', '/src/views/home/index.tmvc', true);
    expect(code).toContain('import "./index.tmvc.css";');
  });

  it('emits the import for a layout', () => {
    const { code } = transformTmvc('<div>${context.slot}</div>', '/src/layouts/AppLayout.tmvc', true);
    expect(code).toContain('import "./AppLayout.tmvc.css";');
  });

  it('emits the import for a component that declares a @local block', () => {
    const { code } = transformTmvc(
      '@local {\n  const open = signal(false);\n}\n<div class="panel"></div>',
      '/src/components/Panel.tmvc',
      true,
    );
    expect(code).toContain('import "./Panel.tmvc.css";');
  });

  it('names the stylesheet by filename, so it resolves against the document directory', () => {
    const { code } = transformTmvc('<p>x</p>', 'C:\\app\\src\\components\\Pill.tmvc', true);
    expect(code).toContain('import "./Pill.tmvc.css";');
  });

  it('emits no import when there is no sibling stylesheet', () => {
    const { code } = transformTmvc('<span class="pill">x</span>', '/src/components/Pill.tmvc');
    expect(code).not.toContain('.css');
    expect(code).not.toContain('import "./');
  });

  it('compiles a document with no stylesheet exactly as it did without the feature', () => {
    const source = '<span class="pill">${props.label}</span>';
    const id = '/src/components/Pill.tmvc';
    expect(transformTmvc(source, id, false)).toEqual(transformTmvc(source, id));
  });

  it('carries the import alongside a layout @parent export on the same line', () => {
    const { code } = transformTmvc(
      '@parent AppLayout\n<div>${context.slot}</div>',
      '/src/layouts/BooksLayout.tmvc',
      true,
    );
    const firstLine = code.split('\n')[0] ?? '';
    expect(firstLine).toContain('import "./BooksLayout.tmvc.css";');
    expect(firstLine).toContain('export const parent = "AppLayout";');
  });
});

describe('the stylesheet import does not move the generated module', () => {
  const source = '<h1>${context.model.title}</h1>\n<p>second</p>\n<p>third</p>';
  const id = '/src/views/home/index.tmvc';

  it('rides on the first line, adding no line to the module', () => {
    const styled = transformTmvc(source, id, true).code.split('\n');
    const plain = transformTmvc(source, id).code.split('\n');

    expect(styled[0]).toContain('import "./index.tmvc.css";');
    expect(styled.length).toBe(plain.length);
    expect(styled.slice(1)).toEqual(plain.slice(1));
  });

  it('leaves the preamble three lines, so template content still starts on line 4', () => {
    const lines = transformTmvc(source, id, true).code.split('\n');
    expect(lines[3]).toBe('  return html`<h1>${context.model.title}</h1>');
  });

  it('leaves the template start column at 14', () => {
    const lines = transformTmvc(source, id, true).code.split('\n');
    expect((lines[3] ?? '').indexOf('<h1>')).toBe(14);
  });

  it('produces a byte-identical source map with and without the import', () => {
    expect(transformTmvc(source, id, true).map).toBe(transformTmvc(source, id).map);
  });

  it('still maps the first template line to source line 1 column 0', () => {
    const { mappings } = parseMap(transformTmvc(source, id, true));
    const parts = mappings.split(';');
    // Three unmapped preamble lines, then generated column 14 -> source line 0.
    expect(parts[0]).toBe('');
    expect(parts[1]).toBe('');
    expect(parts[2]).toBe('');
    expect(parts[3]).toBe('cAAA');
    expect(parts[4]).toBe('AACA');
    expect(parts[5]).toBe('AACA');
  });

  it('still maps a lifted @local statement to its own source line', () => {
    const local = '@local {\n  const open = signal(false);\n}\n<div></div>';
    const componentId = '/src/components/Panel.tmvc';
    expect(transformTmvc(local, componentId, true).map).toBe(
      transformTmvc(local, componentId).map,
    );
  });
});

describe('load reads the sibling stylesheet off disk', () => {
  let dir: string;
  const ctx = { addWatchFile: (): void => undefined };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'typemvc-styles-'));
    mkdirSync(join(dir, 'components'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, content: string): string {
    const path = join(dir, 'components', name).replaceAll('\\', '/');
    writeFileSync(path, content);
    return path;
  }

  it('imports the stylesheet when the sibling file exists', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const tmvc = write('Pill.tmvc', '<span class="pill">${props.label}</span>');
    write('Pill.tmvc.css', '.pill { border-radius: 999px; }');

    const result = plugin.load.call(ctx, toTmvcVirtualId(tmvc));
    expect(result?.code).toContain('import "./Pill.tmvc.css";');
  });

  it('emits no import when the sibling file does not exist', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const tmvc = write('Bare.tmvc', '<span>${props.label}</span>');

    const result = plugin.load.call(ctx, toTmvcVirtualId(tmvc));
    expect(result?.code).not.toContain('.css');
  });

  it('does not treat a hand-authored Name.css as the sibling', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const tmvc = write('Card.tmvc', '<article></article>');
    write('Card.css', '.card { color: red; }');

    const result = plugin.load.call(ctx, toTmvcVirtualId(tmvc));
    expect(result?.code).not.toContain('.css');
  });
});

describe('hot update for a sibling stylesheet', () => {
  const virtualModule = { id: '/src/components/Pill.tmvc.ts' };

  function hotUpdate(
    plugin: TmvcPlugin,
    file: string,
    type: TmvcHotUpdateType,
    modules: readonly unknown[] = [],
    known: readonly string[] = [virtualModule.id],
  ): unknown[] | undefined {
    return plugin.hotUpdate({
      file,
      type,
      modules,
      environment: {
        moduleGraph: {
          getModuleById: (id: string) => (known.includes(id) ? virtualModule : undefined),
        },
      },
    });
  }

  it('leaves an edited stylesheet to the bundler, so the document is not re-transformed', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = hotUpdate(plugin, '/src/components/Pill.tmvc.css', 'update', [{ id: 'css' }]);
    expect(result).toBeUndefined();
  });

  it('invalidates the document when a stylesheet is created for it', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = hotUpdate(plugin, '/src/components/Pill.tmvc.css', 'create');
    expect(result).toEqual([virtualModule]);
  });

  it('invalidates the document when its stylesheet is deleted', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = hotUpdate(plugin, '/src/components/Pill.tmvc.css', 'delete');
    expect(result).toEqual([virtualModule]);
  });

  it('keeps the modules the bundler already collected for the change', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const other = { id: 'other' };
    const result = hotUpdate(plugin, '/src/components/Pill.tmvc.css', 'delete', [other]);
    expect(result).toEqual([other, virtualModule]);
  });

  it('does nothing when the document has never been loaded', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = hotUpdate(plugin, '/src/components/Pill.tmvc.css', 'create', [], []);
    expect(result).toBeUndefined();
  });

  it('ignores a stylesheet that is not a sibling of a document', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    expect(hotUpdate(plugin, '/src/styles/tokens.css', 'update')).toBeUndefined();
    expect(hotUpdate(plugin, '/src/styles/tokens.css', 'create')).toBeUndefined();
  });

  it('returns the virtual module for an edited document', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    const result = hotUpdate(plugin, '/src/components/Pill.tmvc', 'update');
    expect(result).toEqual([virtualModule]);
  });

  it('ignores a file that is neither a document nor a sibling stylesheet', () => {
    const plugin: TmvcPlugin = typemvcPlugin();
    expect(hotUpdate(plugin, '/src/main.ts', 'update')).toBeUndefined();
  });
});

describe('the runtime parser tolerates a co-located stylesheet', () => {
  it('parses the source of a document that has one, and loads no styles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'typemvc-styles-'));
    try {
      const tmvc = join(dir, 'Pill.tmvc').replaceAll('\\', '/');
      const source = '<span class="pill">${context.data.label}</span>';
      writeFileSync(tmvc, source);
      writeFileSync(toTmvcStylePath(tmvc), '.pill { border-radius: 999px; }');

      // The parser is handed source text and never a path, so a sibling on disk
      // is invisible to it: it compiles the same view, without the stylesheet.
      expect(typeof parseTmvc(source)).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('prefixed class and style bindings compile through .tmvc', () => {
  it('carries a class binding from a view into the generated template', () => {
    const { code } = transformTmvc(
      '<li class="row" class:is-active="${context.model.active}">x</li>',
      '/src/views/todo/index.tmvc',
    );

    expect(code).toContain('class:is-active="${context.model.active}"');
  });

  it('carries a style binding from a view into the generated template', () => {
    const { code } = transformTmvc(
      '<div class="bar" style:--fill="${context.model.percent}%"></div>',
      '/src/views/todo/index.tmvc',
    );

    expect(code).toContain('style:--fill="${context.model.percent}%"');
  });

  it('carries both prefixes from a component template into the generated template', () => {
    const { code } = transformTmvc(
      '<div class:is-open="${props.open}" style:--x="${props.x}"></div>',
      '/src/components/panel.tmvc',
    );

    expect(code).toContain('class:is-open="${props.open}"');
    expect(code).toContain('style:--x="${props.x}"');
  });

  it('carries both prefixes out of a component @local block', () => {
    const { code } = transformTmvc(
      '@local {\n  const open = signal(false);\n}\n<div class:is-open="${open}" style:--x="${props.x}"></div>',
      '/src/components/panel.tmvc',
    );

    expect(code).toContain('class:is-open="${open}"');
    expect(code).toContain('style:--x="${props.x}"');
  });
});
