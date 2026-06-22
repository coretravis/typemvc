/**
 * Issue 048: every value and type exported from the public barrel (src/index.ts)
 * must carry a TSDoc documentation comment, so it surfaces in editor hover,
 * autocomplete, and signature help for developers building on the framework.
 *
 * The check uses the TypeScript compiler API over the source (not the build
 * output) and resolves re-export aliases to the original declaration, so it is
 * robust regardless of build state.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const entry = join(repoRoot, 'src', 'index.ts');

// Symbols re-exported only for the framework's own generated code, not part of
// the developer-facing API. They are intentionally undocumented.
const INTERNAL_EXPORTS = new Set(['_callComponent']);

function getDocumentedState(): { documented: string[]; undocumented: string[] } {
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entry);
  if (sourceFile === undefined) throw new Error('Could not load src/index.ts');

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) throw new Error('Could not resolve module symbol');

  const documented: string[] = [];
  const undocumented: string[] = [];

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    if (INTERNAL_EXPORTS.has(name)) continue;

    // Resolve re-export aliases to the original declaration's symbol.
    const symbol =
      (exported.flags & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(exported)
        : exported;

    const doc = symbol.getDocumentationComment(checker);
    const text = ts.displayPartsToString(doc).trim();
    if (text.length > 0) documented.push(name);
    else undocumented.push(name);
  }

  return { documented, undocumented };
}

describe('048: public API documentation coverage', () => {
  it('every public barrel export has a TSDoc comment', () => {
    const { undocumented } = getDocumentedState();
    expect(undocumented, `Undocumented public exports: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('documents a meaningful number of exports (guards against an empty barrel)', () => {
    const { documented } = getDocumentedState();
    expect(documented.length).toBeGreaterThan(30);
  });
});

describe('048: strategic symbols include an @example', () => {
  // These are the highest-traffic symbols; their docs must show usage.
  const STRATEGIC = ['View', 'controller', 'get', 'post', 'signal', 'computed', 'effect', 'inject'];

  it('the strategic symbols carry an @example tag', () => {
    const program = ts.createProgram([entry], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(entry);
    if (sourceFile === undefined) throw new Error('Could not load src/index.ts');
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) throw new Error('Could not resolve module symbol');

    const exportsByName = new Map(
      checker.getExportsOfModule(moduleSymbol).map((s) => [s.getName(), s]),
    );

    const missing: string[] = [];
    for (const name of STRATEGIC) {
      const exported = exportsByName.get(name);
      if (exported === undefined) {
        missing.push(`${name} (not exported)`);
        continue;
      }
      const symbol =
        (exported.flags & ts.SymbolFlags.Alias) !== 0
          ? checker.getAliasedSymbol(exported)
          : exported;
      const tags = symbol.getJsDocTags(checker);
      if (!tags.some((t) => t.name === 'example')) missing.push(name);
    }

    expect(missing, `Strategic symbols missing @example: ${missing.join(', ')}`).toEqual([]);
  });
});
