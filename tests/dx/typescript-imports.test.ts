// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  transformTmvc,
  loadTmvcModule,
  validateTmvcSource,
  extractDirective,
  describeValidationError,
  hasTypeAnnotation,
} from '../../src/vite-plugin/index.js';
import { generateVirtualTs } from '../../src/volar-plugin/index.js';
import { parseTmvc } from '../../src/runtime-parser/index.js';

const VIEW_ID = '/src/views/report/index.tmvc';
const COMPONENT_ID = '/src/components/Shelf.tmvc';

// ---------------------------------------------------------------------------
// @use directive parsing
// ---------------------------------------------------------------------------

describe('extractDirective: @use', () => {
  it('parses a named @use line after @model and blanks both', () => {
    const src =
      "@model { rows: Row[] }\n@use { ICONS, formatCurrency } from '../lib/display'\n<td>${formatCurrency(rows[0].total)}</td>";
    const { uses, body, directive } = extractDirective(src);
    expect(directive).toEqual({ kind: 'model-type', expr: '{ rows: Row[] }' });
    expect(uses).toHaveLength(1);
    expect(uses[0]?.clause).toBe('{ ICONS, formatCurrency }');
    expect(uses[0]?.specifier).toBe('../lib/display');
    expect(uses[0]?.line).toBe(1);
    // The directive lines are whited out; length and line count are preserved.
    expect(body.length).toBe(src.length);
    expect(body.split('\n').length).toBe(src.split('\n').length);
    expect(body).not.toContain('@use');
    expect(body).not.toContain('@model');
    expect(body.split('\n')[2]).toBe('<td>${formatCurrency(rows[0].total)}</td>');
  });

  it('parses a @use line with no @model as the first directive', () => {
    const { uses, directive } = extractDirective(
      "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>",
    );
    expect(directive).toBeNull();
    expect(uses).toHaveLength(1);
    expect(uses[0]?.specifier).toBe('../lib/icons');
  });

  it('collects several @use lines', () => {
    const { uses } = extractDirective(
      "@use { A } from '../a'\n@use { B } from '../b'\n<p></p>",
    );
    expect(uses.map((u) => u.specifier)).toEqual(['../a', '../b']);
  });

  it('stops collecting at the first markup line', () => {
    const { uses } = extractDirective(
      "@use { A } from '../a'\n<p></p>\n@use { B } from '../b'",
    );
    expect(uses).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC10, AC11, AC13: @use compiles to an import
// ---------------------------------------------------------------------------

describe('transformTmvc: @use imports (AC10, AC11, AC13)', () => {
  it('emits a named import and keeps the binding in the markup expression', () => {
    const { code } = transformTmvc(
      "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>",
      VIEW_ID,
    );
    expect(code).toContain("import { ICONS } from '../lib/icons';");
    expect(code).toContain('${ICONS.home}');
  });

  it('emits multiple named bindings on one import', () => {
    const { code } = transformTmvc(
      "@use { A, B, C } from '../lib/x'\n<p>${A}${B}${C}</p>",
      VIEW_ID,
    );
    expect(code).toContain("import { A, B, C } from '../lib/x';");
  });

  it('emits a default import', () => {
    const { code } = transformTmvc(
      "@use format from '../lib/format'\n<p>${format(1)}</p>",
      VIEW_ID,
    );
    expect(code).toContain("import format from '../lib/format';");
  });

  it('emits a namespace import', () => {
    const { code } = transformTmvc(
      "@use * as display from '../lib/display'\n<p>${display.title}</p>",
      VIEW_ID,
    );
    expect(code).toContain("import * as display from '../lib/display';");
  });

  it('passes a bare package specifier through verbatim', () => {
    const { code } = transformTmvc(
      "@use { format } from 'date-fns'\n<p>${format}</p>",
      VIEW_ID,
    );
    expect(code).toContain("import { format } from 'date-fns';");
  });

  it('keeps the import at module scope, above the render function', () => {
    const { code } = transformTmvc(
      "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>",
      VIEW_ID,
    );
    const importIdx = code.indexOf("import { ICONS }");
    const renderIdx = code.indexOf('export default function render');
    expect(importIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeLessThan(renderIdx);
  });
});

// ---------------------------------------------------------------------------
// AC12: a @use binding is in scope inside @local
// ---------------------------------------------------------------------------

describe('transformTmvc: @use in @local (AC12)', () => {
  it('makes the binding available to lifted @local statements', () => {
    const src =
      "@use { CONFIG } from '../lib/config'\n" +
      '@local {\n' +
      '  const count = signal(CONFIG.start);\n' +
      '}\n' +
      '<span>${count}</span>';
    const { code } = transformTmvc(src, COMPONENT_ID);
    expect(code).toContain("import { CONFIG } from '../lib/config';");
    expect(code).toContain('const count = signal(CONFIG.start);');
    const importIdx = code.indexOf("import { CONFIG }");
    const stmtIdx = code.indexOf('const count = signal(CONFIG.start);');
    expect(importIdx).toBeLessThan(stmtIdx);
  });
});

// ---------------------------------------------------------------------------
// AC14: a bare import is still rejected, and the message names @use
// ---------------------------------------------------------------------------

describe('validateTmvcSource: bare import names @use (AC14)', () => {
  it('flags a bare import statement', () => {
    const errors = validateTmvcSource("import { X } from '../x';\n<p></p>");
    expect(errors[0]?.kind).toBe('import-statement');
  });

  it('the import-statement message names @use as the supported form', () => {
    const message = describeValidationError({
      kind: 'import-statement',
      line: 1,
      source: '',
    });
    expect(message).toContain('@use');
  });
});

// ---------------------------------------------------------------------------
// AC15: await and fetch stay rejected by the @local denylist
// ---------------------------------------------------------------------------

describe('validateTmvcSource: denylist still applies with @use (AC15)', () => {
  it('rejects await on a @use binding result inside @local', () => {
    const src =
      "@use { load } from '../lib/load'\n@local {\n  const data = await load();\n}\n<p></p>";
    const errors = validateTmvcSource(src, COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-async')).toBe(true);
  });

  it('rejects fetch inside @local even with @use present', () => {
    const src =
      "@use { url } from '../lib/url'\n@local {\n  const r = fetch(url);\n}\n<p></p>";
    const errors = validateTmvcSource(src, COMPONENT_ID);
    expect(errors.some((e) => e.kind === 'local-fetch')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC16: @use is valid only in the top directive block
// ---------------------------------------------------------------------------

describe('validateTmvcSource: @use position (AC16)', () => {
  it('does not flag a @use in the directive block', () => {
    const errors = validateTmvcSource(
      "@use { X } from '../x'\n<p>${X}</p>",
      VIEW_ID,
    );
    expect(errors.some((e) => e.kind === 'invalid-use-directive')).toBe(false);
  });

  it('flags a @use that appears after markup', () => {
    const errors = validateTmvcSource(
      "<p>hi</p>\n@use { X } from '../x'",
      VIEW_ID,
    );
    const misplaced = errors.filter((e) => e.kind === 'invalid-use-directive');
    expect(misplaced).toHaveLength(1);
    expect(misplaced[0]?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC1, AC3: type annotations survive into the emitted module (esbuild strips)
// ---------------------------------------------------------------------------

describe('transformTmvc: type annotations pass through to esbuild (AC1, AC3)', () => {
  it('emits a typed @local signal declaration verbatim', () => {
    const src =
      '@local {\n  const count = signal<number>(0);\n}\n<span>${count}</span>';
    const { code } = transformTmvc(src, COMPONENT_ID);
    expect(code).toContain('const count = signal<number>(0);');
  });

  it('emits a typed function declaration verbatim', () => {
    const src =
      '@local {\n  function inc(): void { return; }\n}\n<span>x</span>';
    const { code } = transformTmvc(src, COMPONENT_ID);
    expect(code).toContain('function inc(): void');
  });

  it('emits a type annotation inside a template expression verbatim', () => {
    const { code } = transformTmvc(
      '<p>${(context.data.n as number) + 1}</p>',
      VIEW_ID,
    );
    expect(code).toContain('context.data.n as number');
  });
});

// ---------------------------------------------------------------------------
// AC9: the Volar virtual file and the emitted module share the same source text
// ---------------------------------------------------------------------------

describe('Volar and build agree on @use (AC9, AC17)', () => {
  it('both the transform and the virtual file emit the @use import', () => {
    const src = "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>";
    const built = transformTmvc(src, VIEW_ID).code;
    const virtual = generateVirtualTs(src, VIEW_ID, null).code;
    expect(built).toContain("import { ICONS } from '../lib/icons';");
    expect(virtual).toContain("import { ICONS } from '../lib/icons';");
  });

  it('the virtual file keeps the render body so the binding type-checks', () => {
    const src = "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>";
    const virtual = generateVirtualTs(src, VIEW_ID, null).code;
    expect(virtual).toContain('${ICONS.home}');
    expect(virtual).toContain('export default function render');
  });
});

// ---------------------------------------------------------------------------
// AC5, AC19: source map line accounting with @use present
// ---------------------------------------------------------------------------

describe('transformTmvc: source map accounting with @use (AC19)', () => {
  it('adds one unmapped preamble line per @use directive', () => {
    const src = "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>";
    const { map } = transformTmvc(src, VIEW_ID);
    const parsed = JSON.parse(map) as { mappings: string; sourcesContent: string[] };
    const parts = parsed.mappings.split(';');
    // Four unmapped preamble lines: core import, the @use import, the blank line,
    // and the function opener.
    expect(parts[0]).toBe('');
    expect(parts[1]).toBe('');
    expect(parts[2]).toBe('');
    expect(parts[3]).toBe('');
    expect(parts[4]).toBe('cAAA');
    expect(parts[5]).toBe('AACA');
    expect(parsed.sourcesContent[0]).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// AC8: the runtime parser rejects type annotations
// ---------------------------------------------------------------------------

describe('parseTmvc: rejects type annotations in @local (AC8)', () => {
  it('rejects a typed generic signal declaration', () => {
    expect(() =>
      parseTmvc('@local {\n  const count = signal<number>(0);\n}\n<span>${count}</span>'),
    ).toThrow('[TypeMVC]');
  });

  it('the type-annotation error names the limitation', () => {
    expect(() =>
      parseTmvc('@local {\n  const count = signal<number>(0);\n}\n<span>${count}</span>'),
    ).toThrow('cannot strip types');
  });

  it('rejects a typed function return annotation', () => {
    expect(() =>
      parseTmvc('@local {\n  function inc(): void { return; }\n}\n<div>x</div>'),
    ).toThrow('[TypeMVC]');
  });

  it('rejects a typed variable declaration', () => {
    expect(() =>
      parseTmvc('@local {\n  const items: string[] = [];\n}\n<div>${items.length}</div>'),
    ).toThrow('[TypeMVC]');
  });

  it('rejects an interface declaration', () => {
    expect(() =>
      parseTmvc('@local {\n  interface Row { id: number }\n  const a = signal(0);\n}\n<div>x</div>'),
    ).toThrow('[TypeMVC]');
  });

  it('rejects a type assertion', () => {
    expect(() =>
      parseTmvc('@local {\n  const n = signal(0 as number);\n}\n<div>${n}</div>'),
    ).toThrow('[TypeMVC]');
  });

  it('accepts an untyped @local block', () => {
    expect(() =>
      parseTmvc('@local {\n  const count = signal(0);\n}\n<span>${count}</span>'),
    ).not.toThrow();
  });

  it('does not flag a ternary that reads as a type-free expression', () => {
    expect(() =>
      parseTmvc(
        '@local {\n  const open = signal(false);\n  const label = computed(() => open.get() ? "open" : "closed");\n}\n<span>${label}</span>',
      ),
    ).not.toThrow();
  });
});

describe('hasTypeAnnotation', () => {
  it('is true for a generic call', () => {
    expect(hasTypeAnnotation('const c = signal<number>(0);')).toBe(true);
  });

  it('is false for a plain call', () => {
    expect(hasTypeAnnotation('const c = signal(0);')).toBe(false);
  });

  it('ignores type-like text inside a string literal', () => {
    expect(hasTypeAnnotation('const s = "const x: string";')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC8 / step 9: the runtime parser rejects @use
// ---------------------------------------------------------------------------

describe('parseTmvc: rejects @use (zero-build has no bundler)', () => {
  it('throws a [TypeMVC] error naming @use', () => {
    expect(() => parseTmvc("@use { X } from '../x'\n<p>${X}</p>")).toThrow('[TypeMVC]');
    expect(() => parseTmvc("@use { X } from '../x'\n<p>${X}</p>")).toThrow('@use');
  });
});

// ---------------------------------------------------------------------------
// loadTmvcModule: validation happens before transform
// ---------------------------------------------------------------------------

describe('loadTmvcModule: @use', () => {
  it('produces a module with the @use import', () => {
    const { code } = loadTmvcModule(
      "@use { ICONS } from '../lib/icons'\n<p>${ICONS.home}</p>",
      VIEW_ID,
    );
    expect(code).toContain("import { ICONS } from '../lib/icons';");
  });

  it('throws when a @use is misplaced', () => {
    expect(() =>
      loadTmvcModule("<p>hi</p>\n@use { X } from '../x'", VIEW_ID),
    ).toThrow('[TypeMVC]');
  });
});
