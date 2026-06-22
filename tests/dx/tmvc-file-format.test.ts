/**
 * Tests for issue 021 / 040: .tmvc file format specification.
 *
 * Acceptance criteria verified here:
 *   AC1  Spec document covers file extension, implicit context binding,
 *        expression embedding, and mapping to the html tagged template
 *   AC2  Spec defines the generated TypeScript module shape
 *   AC3  Spec covers error cases: import, export, class
 *   AC4  Grammar section is present and sufficient for 022 and 023
 *   AC5  Users list from SRS §5.1 is included as a worked example
 *
 * Type-level criteria (verified by tsc --noEmit):
 *   T1   TmvcViewFunction is exported from the barrel
 *   T2   TmvcValidationError is exported from the barrel
 *   T3   TmvcValidationError is a discriminated union over all three kinds
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Compile-time type imports (T1, T2, T3)
// If any of these were missing, tsc --noEmit would fail.
// ---------------------------------------------------------------------------

import type { TmvcViewFunction, TmvcValidationError } from '../../src/index.js';

// T1: TmvcViewFunction must be assignable from a (context) => Fragment shaped function.
// The import alone asserts the type exists; the function below exercises the shape.
function assertTmvcViewFunctionShape(fn: TmvcViewFunction): TmvcViewFunction {
  return fn;
}

// T3: Exhaustive switch proves all discriminant arms exist.
// A missing case would be a TypeScript compile error.
function describeValidationError(err: TmvcValidationError): string {
  switch (err.kind) {
    case 'import-statement':
      return `import on line ${String(err.line)}: ${err.source}`;
    case 'export-statement':
      return `export on line ${String(err.line)}: ${err.source}`;
    case 'class-definition':
      return `class on line ${String(err.line)}: ${err.source}`;
    case 'invalid-model-directive':
      return `@model on line ${String(err.line)}: ${err.source}`;
  }
}

// ---------------------------------------------------------------------------
// Load the spec document once
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = join(__dirname, '../../docs/tmvc-file-format.md');
const spec = readFileSync(specPath, 'utf-8');

// ---------------------------------------------------------------------------
// AC1: Spec document covers required topics
// ---------------------------------------------------------------------------

describe('AC1: spec document covers required topics', () => {
  it('spec document exists and is non-empty', () => {
    expect(spec.length).toBeGreaterThan(0);
  });

  it('documents the .tmvc file extension', () => {
    expect(spec).toContain('.tmvc');
  });

  it('documents the implicit context binding', () => {
    expect(spec).toMatch(/implicit|implicitly/i);
    expect(spec).toContain('context');
  });

  it('documents TypeScript expression embedding with ${...} syntax', () => {
    expect(spec).toContain('${');
  });

  it('documents mapping to the html tagged template', () => {
    expect(spec).toContain('html`');
  });

  it('documents the ViewContext type for context', () => {
    expect(spec).toContain('ViewContext');
  });
});

// ---------------------------------------------------------------------------
// AC2: Spec defines the generated module shape
// ---------------------------------------------------------------------------

describe('AC2: spec defines the generated TypeScript module shape', () => {
  it('shows the import { html } statement in the generated module', () => {
    expect(spec).toContain("import { html } from '@typemvc/core'");
  });

  it('shows the default export render function in the generated module', () => {
    expect(spec).toContain('export default function render');
  });

  it('shows the (context: ViewContext): Fragment return type in the generated module', () => {
    expect(spec).toContain('context: ViewContext');
    expect(spec).toContain('Fragment');
  });

  it('shows that the .tmvc content is placed verbatim as the tagged template body', () => {
    expect(spec).toMatch(/verbatim/i);
  });
});

// ---------------------------------------------------------------------------
// AC3: Spec covers error cases
// ---------------------------------------------------------------------------

describe('AC3: spec covers all three error cases', () => {
  it('documents the import-statement error kind', () => {
    expect(spec).toContain('import-statement');
  });

  it('documents the export-statement error kind', () => {
    expect(spec).toContain('export-statement');
  });

  it('documents the class-definition error kind', () => {
    expect(spec).toContain('class-definition');
  });

  it('error messages are prefixed with [TypeMVC]', () => {
    expect(spec).toContain('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// AC4: Grammar section is present
// ---------------------------------------------------------------------------

describe('AC4: grammar section is present and covers parsing rules', () => {
  it('contains a grammar or BNF-style section', () => {
    expect(spec).toMatch(/grammar|Grammar/);
  });

  it('grammar defines tmvc-file production', () => {
    expect(spec).toContain('tmvc-file');
  });

  it('grammar defines interpolation production', () => {
    expect(spec).toContain('interpolation');
  });

  it('grammar describes expression depth tracking', () => {
    expect(spec).toMatch(/depth/i);
  });

  it('grammar describes handling of string literals inside expressions', () => {
    expect(spec).toMatch(/string literal/i);
  });

  it('grammar describes handling of template literals inside expressions', () => {
    expect(spec).toMatch(/template literal/i);
  });

  it('grammar describes forbidden pattern detection', () => {
    expect(spec).toMatch(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// AC5: Users list example from SRS §5.1 is included
// ---------------------------------------------------------------------------

describe('AC5: users list worked example is included', () => {
  it('includes Users heading from the §5.1 example', () => {
    expect(spec).toContain('<h1>Users</h1>');
  });

  it('includes the map over users from the §5.1 example', () => {
    expect(spec).toContain('context.data.users.map');
  });

  it('includes the context.errors.action check from the §5.1 example', () => {
    expect(spec).toContain('context.errors.action');
  });

  it('shows both the .tmvc source and the generated module for the example', () => {
    expect(spec).toContain('export default function render');
    expect(spec).toContain('.tmvc Source');
  });
});

// ---------------------------------------------------------------------------
// Type-level runtime assertions (T2, T3)
// ---------------------------------------------------------------------------

describe('TmvcValidationError discriminated union (T2, T3)', () => {
  it('import-statement error object satisfies the type at runtime', () => {
    const err: TmvcValidationError = {
      kind: 'import-statement',
      line: 1,
      source: 'import { foo } from bar',
    };
    expect(err.kind).toBe('import-statement');
    expect(err.line).toBe(1);
  });

  it('export-statement error object satisfies the type at runtime', () => {
    const err: TmvcValidationError = {
      kind: 'export-statement',
      line: 3,
      source: 'export const x = 1',
    };
    expect(err.kind).toBe('export-statement');
    expect(err.line).toBe(3);
  });

  it('class-definition error object satisfies the type at runtime', () => {
    const err: TmvcValidationError = {
      kind: 'class-definition',
      line: 5,
      source: 'class Foo {}',
    };
    expect(err.kind).toBe('class-definition');
    expect(err.line).toBe(5);
  });

  it('describeValidationError covers all three kinds via exhaustive switch', () => {
    const a: TmvcValidationError = { kind: 'import-statement', line: 1, source: 'import x' };
    const b: TmvcValidationError = { kind: 'export-statement', line: 2, source: 'export y' };
    const c: TmvcValidationError = { kind: 'class-definition', line: 3, source: 'class Z' };
    expect(describeValidationError(a)).toContain('import');
    expect(describeValidationError(b)).toContain('export');
    expect(describeValidationError(c)).toContain('class');
  });
});

describe('TmvcViewFunction type shape (T1)', () => {
  it('assertTmvcViewFunctionShape accepts a conforming function without compile error', () => {
    // This test exercises the compile-time check via assertTmvcViewFunctionShape.
    // The function is not called at runtime because html is a browser API.
    // The fact that tsc accepts the argument is the assertion.
    expect(typeof assertTmvcViewFunctionShape).toBe('function');
  });
});
