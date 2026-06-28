/**
 * Tests for issue 025 / 039 / 040: VS Code language intelligence for .tmvc files via Volar.
 *
 * Acceptance criteria verified here:
 *   AC1  Volar plugin activates for .tmvc files
 *   AC2  context.data.<key> completions reflect controller action return-type IView<T>
 *   AC3  Type errors in .tmvc expressions are reported inline
 *   AC4  Hover over context.data.users shows the TypeScript type
 *   AC5  Go-to-definition navigates to the method in the controller .ts file
 *   AC6  Language server does not report errors for the implicit context binding
 *   AC7  Completions and type checking survive incremental edits
 */

import { describe, it, expect } from 'vitest';
import {
  createTmvcLanguagePlugin,
  createTmvcSnapshot,
  generateVirtualTs,
  getTmvcDiagnostics,
  collectComponentNames,
  getControllerCandidatePaths,
  getControllerCandidatePathsByName,
  getComponentCandidatePathsByName,
  scanComponentUsages,
  findOwningController,
  type TmvcVolarPluginOptions,
} from '../../src/volar-plugin/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, '../../extensions/tmvc-syntax');
const workspaceRoot = join(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(content: string) {
  return createTmvcSnapshot(content);
}

const SIMPLE_TMVC = '<h1>${context.data.title}</h1>';
const USERS_TMVC = `<ul>
\${context.data.users.map(u => html\`<li>\${u.name}</li>\`)}
</ul>`;

// ---------------------------------------------------------------------------
// AC1: Volar plugin activates for .tmvc files
// ---------------------------------------------------------------------------

describe('AC1: plugin activates for .tmvc files', () => {
  const plugin = createTmvcLanguagePlugin();

  it('getLanguageId returns tmvc for .tmvc files', () => {
    expect(plugin.getLanguageId('views/users/index.tmvc')).toBe('tmvc');
  });

  it('getLanguageId returns tmvc for a nested .tmvc path', () => {
    expect(plugin.getLanguageId('views/admin-users/list.tmvc')).toBe('tmvc');
  });

  it('getLanguageId returns undefined for .ts files', () => {
    expect(plugin.getLanguageId('src/controllers/UsersController.ts')).toBeUndefined();
  });

  it('getLanguageId returns undefined for .html files', () => {
    expect(plugin.getLanguageId('views/index.html')).toBeUndefined();
  });

  it('getLanguageId returns undefined for files without extension', () => {
    expect(plugin.getLanguageId('views/users/index')).toBeUndefined();
  });

  it('createVirtualCode returns a virtual code for languageId tmvc', () => {
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const result = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    expect(result).toBeDefined();
  });

  it('createVirtualCode returns undefined for non-tmvc languageId', () => {
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const result = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'typescript',
      snapshot,
    );
    expect(result).toBeUndefined();
  });

  it('virtual code has id "main"', () => {
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const result = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    expect(result?.id).toBe('main');
  });

  it('virtual code has languageId "typescript"', () => {
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const result = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    expect(result?.languageId).toBe('typescript');
  });

  it('extension manifest contributes a language with .tmvc extension', () => {
    const raw = readFileSync(join(extRoot, 'package.json'), 'utf-8');
    const manifest = JSON.parse(raw) as {
      contributes?: { languages?: { extensions?: string[] }[] };
    };
    const languages = manifest.contributes?.languages ?? [];
    const hasTmvcLang = languages.some((l) =>
      l.extensions?.includes('.tmvc'),
    );
    expect(hasTmvcLang).toBe(true);
  });

  it('extension manifest has a main entry point for the language server', () => {
    const raw = readFileSync(join(extRoot, 'package.json'), 'utf-8');
    const manifest = JSON.parse(raw) as { main?: string };
    expect(typeof manifest.main).toBe('string');
    expect((manifest.main ?? '').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC2: context.data types derived from controller action return type IView<T>
// ---------------------------------------------------------------------------

describe('AC2: context.data types derived from controller action return type', () => {
  it('generateVirtualTs without controller uses ViewContext for context', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain('context: ViewContext');
    expect(result.code).toContain("from '@typemvc/core'");
  });

  it('generateVirtualTs with controller imports the controller type', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain('UsersController');
    expect(result.code).toContain('__OwnerController');
  });

  it('generated code with controller uses distributive extraction for __TmvcData', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain('__TmvcData');
    expect(result.code).toContain('__ActionReturn');
    expect(result.code).toContain('__ExtractModel');
    expect(result.code).not.toContain('__ViewReturnType');
  });

  it('action name is derived from the .tmvc filename basename', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    // basename of index.tmvc → action name "index"
    expect(result.code).toContain('index(');
  });

  it('generated context type includes typed data when controller is found', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain('TypedViewContext<__TmvcData>');
    expect(result.code).toContain('__TmvcData');
  });

  it('generated controller import path is relative to the .tmvc file directory', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    // views/users -> src/controllers: ../../src/controllers/UsersController
    expect(result.code).toContain('../../src/controllers/UsersController');
  });

  it('import path uses forward slashes regardless of platform', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    const importLine = result.code
      .split('\n')
      .find((l) => l.includes('__OwnerController'));
    expect(importLine).toBeDefined();
    if (!importLine) return;
    expect(importLine).not.toContain('\\');
  });

  it('generateVirtualTs gracefully handles nested view path', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/admin/users/index.tmvc',
      'src/controllers/AdminUsersController.ts',
    );
    expect(result.code).toContain('../../../src/controllers/AdminUsersController');
  });

  it('conditional type falls back to Record<string, unknown> when action absent', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain('Record<string, unknown>');
  });

  it('action name from detail.tmvc is "detail"', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/detail.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain('detail(');
  });

  it('generated code does not use legacy static-property context pattern', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).not.toContain('_tmvcContext');
    expect(result.code).not.toContain('_tmvcMethods');
  });
});

// ---------------------------------------------------------------------------
// AC3: type errors in .tmvc expressions are reported inline
// ---------------------------------------------------------------------------

describe('AC3: type errors are reported via valid TypeScript structure', () => {
  it('generated virtual file starts with typemvc imports', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code.startsWith("import { html } from '@typemvc/core';")).toBe(true);
  });

  it('generated virtual file imports html as a value (callable)', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain("import { html } from '@typemvc/core';");
    expect(result.code).not.toContain("import type { html }");
  });

  it('generated virtual file imports ViewContext as a type', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain("import type { ViewContext } from '@typemvc/core';");
  });

  it('generated virtual file imports Fragment as a type', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain("import type { Fragment } from '@typemvc/core';");
  });

  it('generated virtual file with controller imports TypedViewContext as a type', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain("import type { TypedViewContext } from '@typemvc/core';");
  });

  it('render function has explicit Fragment return type annotation', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain('): Fragment {');
  });

  it('render function body uses html tagged template literal', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain('return html`');
  });

  it('tmvc source content is embedded inside the html template literal', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    const templateStart = result.code.indexOf('return html`') + 'return html`'.length;
    const templateEnd = result.code.lastIndexOf('`;\n}');
    expect(templateEnd).toBeGreaterThan(templateStart);
    const templateContent = result.code.slice(templateStart, templateEnd);
    expect(templateContent.length).toBeGreaterThan(0);
  });

  it('preamble length is positive and content starts after the preamble', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.preambleLength).toBeGreaterThan(0);
    const contentStart = result.code.slice(result.preambleLength, result.preambleLength + 5);
    expect(contentStart.length).toBeGreaterThan(0);
  });

  it('virtual code snapshot getText returns the generated code', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const fullCode = virtualCode.snapshot.getText(
      0,
      virtualCode.snapshot.getLength(),
    );
    expect(fullCode).toContain("import { html } from '@typemvc/core';");
    expect(fullCode).toContain('function render(context:');
  });
});

// ---------------------------------------------------------------------------
// AC4: hover shows the TypeScript type
// ---------------------------------------------------------------------------

describe('AC4: source mappings enable hover via position mapping', () => {
  it('virtual code has at least one source mapping', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    expect(virtualCode.mappings.length).toBeGreaterThan(0);
  });

  it('source mapping generatedOffset starts at the preamble end', () => {
    const generated = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const firstMapping = virtualCode.mappings[0];
    if (!firstMapping) throw new Error('Expected mapping');
    const generatedOffset = firstMapping.generatedOffsets[0];
    expect(generatedOffset).toBe(generated.preambleLength);
  });

  it('source mapping sourceOffset starts at 0 (beginning of .tmvc source)', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const firstMapping = virtualCode.mappings[0];
    if (!firstMapping) throw new Error('Expected mapping');
    const sourceOffset = firstMapping.sourceOffsets[0];
    expect(sourceOffset).toBe(0);
  });

  it('source mapping has semantic: true for hover support', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const firstMapping = virtualCode.mappings[0];
    if (!firstMapping) throw new Error('Expected mapping');
    expect(firstMapping.data.semantic).toBe(true);
  });

  it('source mapping has completion: true for completion support', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const firstMapping = virtualCode.mappings[0];
    if (!firstMapping) throw new Error('Expected mapping');
    expect(firstMapping.data.completion).toBe(true);
  });

  it('source mapping covers a positive length', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const firstMapping = virtualCode.mappings[0];
    if (!firstMapping) throw new Error('Expected mapping');
    const length = firstMapping.lengths[0];
    expect(length).toBeDefined();
    if (length === undefined) return;
    expect(length).toBeGreaterThan(0);
  });

  it('empty .tmvc source produces no mappings', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot('');
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    expect(virtualCode.mappings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC5: go-to-definition navigates to the controller
// ---------------------------------------------------------------------------

describe('AC5: go-to-definition supported via navigation mappings and controller import', () => {
  it('source mapping has navigation: true for go-to-definition support', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    const firstMapping = virtualCode.mappings[0];
    if (!firstMapping) throw new Error('Expected mapping');
    expect(firstMapping.data.navigation).toBe(true);
  });

  it('virtual file with controller has an import statement the TS server can resolve', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    const lines = result.code.split('\n');
    const importLine = lines.find((l) => l.includes('__OwnerController'));
    expect(importLine).toBeDefined();
    if (!importLine) return;
    expect(importLine).toContain('import type');
  });

  it('controller import uses a resolvable relative path (starts with .)', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    const lines = result.code.split('\n');
    const importLine = lines.find((l) => l.includes('__OwnerController'));
    expect(importLine).toBeDefined();
    if (!importLine) return;
    const match = /'([^']+)'/.exec(importLine);
    expect(match).toBeDefined();
    if (!match) return;
    const importPath = match[1] ?? '';
    expect(importPath.startsWith('.') || importPath.startsWith('..')).toBe(true);
  });

  it('getControllerCandidatePaths returns paths containing the controller name', () => {
    const candidates = getControllerCandidatePaths(
      'views/users/index.tmvc',
      '/workspace',
    );
    expect(candidates.length).toBeGreaterThan(0);
    const allContainController = candidates.every((p) =>
      p.includes('UsersController'),
    );
    expect(allContainController).toBe(true);
  });

  it('getControllerCandidatePaths returns paths in src/controllers first', () => {
    const candidates = getControllerCandidatePaths(
      'views/users/index.tmvc',
      '/workspace',
    );
    const first = candidates[0] ?? '';
    expect(first).toContain('src');
    expect(first).toContain('controllers');
  });

  it('getControllerCandidatePaths handles kebab-case controller directory', () => {
    const candidates = getControllerCandidatePaths(
      'views/admin-users/list.tmvc',
      '/workspace',
    );
    const allContainController = candidates.every((p) =>
      p.includes('AdminUsersController'),
    );
    expect(allContainController).toBe(true);
  });

  it('getControllerCandidatePaths returns empty array for paths not under views/', () => {
    const candidates = getControllerCandidatePaths(
      'src/controllers/UsersController.ts',
      '/workspace',
    );
    expect(candidates.length).toBe(0);
  });

  it('findOwningController returns null when no controller file exists', () => {
    const result = findOwningController(
      'views/nonexistent-controller-xyz/index.tmvc',
      workspaceRoot,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC6: context is explicitly declared in the virtual file render signature
// ---------------------------------------------------------------------------

describe('AC6: context is explicitly declared in the virtual file render signature', () => {
  it('virtual file contains "context" as a function parameter', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain('function render(context:');
  });

  it('context parameter is typed (not untyped or any)', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    const match = /function render\(context: ([^)]+)\)/.exec(result.code);
    expect(match).toBeDefined();
    if (!match) return;
    const paramType = match[1] ?? '';
    expect(paramType.length).toBeGreaterThan(0);
    expect(paramType).not.toBe('any');
  });

  it('ViewContext is imported so context type resolves correctly', () => {
    const result = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result.code).toContain("import type { ViewContext } from '@typemvc/core';");
  });

  it('with controller, context uses TypedViewContext (not untyped)', () => {
    const result = generateVirtualTs(
      SIMPLE_TMVC,
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(result.code).toContain('function render(context: TypedViewContext<__TmvcData>)');
  });

  it('virtual code snapshot is non-empty (context will be seen by language service)', () => {
    const plugin = createTmvcLanguagePlugin();
    const snapshot = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snapshot,
    );
    if (!virtualCode) throw new Error('Expected virtual code');
    expect(virtualCode.snapshot.getLength()).toBeGreaterThan(0);
  });

  it('createTmvcSnapshot getText works for full range', () => {
    const content = '<h1>Hello</h1>';
    const snap = createTmvcSnapshot(content);
    expect(snap.getText(0, snap.getLength())).toBe(content);
  });

  it('createTmvcSnapshot getText works for partial range', () => {
    const content = '<h1>Hello</h1>';
    const snap = createTmvcSnapshot(content);
    expect(snap.getText(0, 4)).toBe('<h1>');
  });

  it('createTmvcSnapshot getChangeRange always returns undefined', () => {
    const snap = createTmvcSnapshot('anything');
    expect(snap.getChangeRange(snap)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC7: completions survive incremental edits
// ---------------------------------------------------------------------------

describe('AC7: completions survive incremental edits', () => {
  const opts: TmvcVolarPluginOptions = { workspaceRoot };
  const plugin = createTmvcLanguagePlugin(opts);

  it('updateVirtualCode returns a new virtual code object', () => {
    const snap1 = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snap1,
    );
    if (!virtualCode) throw new Error('Expected virtual code');

    const snap2 = makeSnapshot('<h2>${context.data.subtitle}</h2>');
    const updated = plugin.updateVirtualCode(
      'views/users/index.tmvc',
      virtualCode,
      snap2,
    );
    expect(updated).toBeDefined();
    expect(updated.id).toBe('main');
    expect(updated.languageId).toBe('typescript');
  });

  it('updateVirtualCode reflects new source content in the snapshot', () => {
    const snap1 = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snap1,
    );
    if (!virtualCode) throw new Error('Expected virtual code');

    const newContent = '<h2>${context.data.subtitle}</h2>';
    const snap2 = makeSnapshot(newContent);
    const updated = plugin.updateVirtualCode(
      'views/users/index.tmvc',
      virtualCode,
      snap2,
    );

    const fullCode = updated.snapshot.getText(0, updated.snapshot.getLength());
    expect(fullCode).toContain('context.data.subtitle');
    expect(fullCode).not.toContain('context.data.title');
  });

  it('updateVirtualCode can be called multiple times (idempotent structure)', () => {
    const snap = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snap,
    );
    if (!virtualCode) throw new Error('Expected virtual code');

    const snap2 = makeSnapshot(USERS_TMVC);
    const updated1 = plugin.updateVirtualCode(
      'views/users/index.tmvc',
      virtualCode,
      snap2,
    );

    const snap3 = makeSnapshot(SIMPLE_TMVC);
    const updated2 = plugin.updateVirtualCode(
      'views/users/index.tmvc',
      updated1,
      snap3,
    );

    const code = updated2.snapshot.getText(0, updated2.snapshot.getLength());
    expect(code).toContain('context.data.title');
  });

  it('generateVirtualTs is deterministic for the same input', () => {
    const result1 = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    const result2 = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    expect(result1.code).toBe(result2.code);
    expect(result1.preambleLength).toBe(result2.preambleLength);
  });

  it('generateVirtualTs produces different code for different source', () => {
    const result1 = generateVirtualTs(SIMPLE_TMVC, 'views/users/index.tmvc', null);
    const result2 = generateVirtualTs(
      '<p>${context.data.count}</p>',
      'views/users/index.tmvc',
      null,
    );
    expect(result1.code).not.toBe(result2.code);
  });

  it('plugin can handle empty .tmvc source on update', () => {
    const snap = makeSnapshot(SIMPLE_TMVC);
    const virtualCode = plugin.createVirtualCode(
      'views/users/index.tmvc',
      'tmvc',
      snap,
    );
    if (!virtualCode) throw new Error('Expected virtual code');

    const emptySnap = makeSnapshot('');
    const updated = plugin.updateVirtualCode(
      'views/users/index.tmvc',
      virtualCode,
      emptySnap,
    );
    expect(updated.mappings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Convention: path mapping tests
// ---------------------------------------------------------------------------

describe('controller convention path mapping', () => {
  it('simple controller name: users -> UsersController', () => {
    const candidates = getControllerCandidatePaths(
      'views/users/list.tmvc',
      '/ws',
    );
    expect(candidates.every((p) => p.includes('UsersController'))).toBe(true);
  });

  it('single-segment path: home -> HomeController', () => {
    const candidates = getControllerCandidatePaths('views/home/index.tmvc', '/ws');
    expect(candidates.every((p) => p.includes('HomeController'))).toBe(true);
  });

  it('multi-word kebab-case: admin-dashboard -> AdminDashboardController', () => {
    const candidates = getControllerCandidatePaths(
      'views/admin-dashboard/index.tmvc',
      '/ws',
    );
    expect(candidates.every((p) => p.includes('AdminDashboardController'))).toBe(
      true,
    );
  });

  it('three-segment path: api-v2-users -> ApiV2UsersController', () => {
    const candidates = getControllerCandidatePaths(
      'views/api-v2-users/index.tmvc',
      '/ws',
    );
    expect(
      candidates.every((p) => p.includes('ApiV2UsersController')),
    ).toBe(true);
  });

  it('path without views/ prefix returns empty candidates', () => {
    const candidates = getControllerCandidatePaths(
      'templates/users/index.tmvc',
      '/ws',
    );
    expect(candidates.length).toBe(0);
  });

  it('returns three workspace-root candidate paths when views/ is at the root', () => {
    const candidates = getControllerCandidatePaths(
      'views/users/index.tmvc',
      '/ws',
    );
    expect(candidates.length).toBe(3);
  });

  it('adds a sibling-of-views candidate for sub-project layouts', () => {
    const candidates = getControllerCandidatePaths(
      '/ws/apps/web/src/views/users/index.tmvc',
      '/ws',
    );
    // The 4th candidate resolves the controller relative to the directory that
    // contains views/, not the workspace root, so monorepo and sub-project
    // layouts (apps/web/src/controllers/...) are found.
    expect(candidates.length).toBe(4);
    expect(candidates[3]?.replace(/\\/g, '/')).toBe(
      '/ws/apps/web/src/controllers/UsersController.ts',
    );
  });
});

// ---------------------------------------------------------------------------
// AC3 (issue 038): component files use props, view files use context
// ---------------------------------------------------------------------------

describe('AC3 (038): component files use props parameter in virtual TypeScript', () => {
  it('path with /components/ produces function render(props: ...)', () => {
    const result = generateVirtualTs(
      '${props.value}',
      'src/components/StatBadge.tmvc',
      null,
    );
    expect(result.code).toContain('function render(props:');
  });

  it('component path does not produce function render(context: ...)', () => {
    const result = generateVirtualTs(
      '${props.value}',
      'src/components/StatBadge.tmvc',
      null,
    );
    expect(result.code).not.toContain('function render(context:');
  });

  it('component virtual TypeScript types props with loose Record plus typed children', () => {
    const result = generateVirtualTs(
      '${props.value}',
      'src/components/StatBadge.tmvc',
      null,
    );
    expect(result.code).toContain('{ readonly children?: Fragment } & Record<string, unknown>');
  });

  it('component virtual TypeScript does not import ViewContext', () => {
    const result = generateVirtualTs(
      '${props.value}',
      'src/components/StatBadge.tmvc',
      null,
    );
    expect(result.code).not.toContain('ViewContext');
  });

  it('component virtual TypeScript still imports html and Fragment', () => {
    const result = generateVirtualTs(
      '${props.value}',
      'src/components/StatBadge.tmvc',
      null,
    );
    expect(result.code).toContain("import { html } from '@typemvc/core';");
    expect(result.code).toContain("import type { Fragment } from '@typemvc/core';");
  });

  it('nested components/ path is also detected', () => {
    const result = generateVirtualTs(
      '${props.label}',
      'src/shared/components/Badge.tmvc',
      null,
    );
    expect(result.code).toContain('function render(props:');
  });

  it('Windows-style backslash path with components is detected', () => {
    const result = generateVirtualTs(
      '${props.label}',
      'src\\components\\Badge.tmvc',
      null,
    );
    expect(result.code).toContain('function render(props:');
  });

  it('view file outside components/ still uses context parameter', () => {
    const result = generateVirtualTs(
      '<h1>${context.data.title}</h1>',
      'src/views/home/index.tmvc',
      null,
    );
    expect(result.code).toContain('function render(context:');
    expect(result.code).not.toContain('function render(props:');
  });

  it('component virtual code snapshot getText reflects props parameter', () => {
    const plugin = createTmvcLanguagePlugin();
    const snap = makeSnapshot('${props.value}');
    const vc = plugin.createVirtualCode('src/components/Icon.tmvc', 'tmvc', snap);
    if (!vc) throw new Error('Expected virtual code');
    const code = vc.snapshot.getText(0, vc.snapshot.getLength());
    expect(code).toContain('function render(props:');
  });
});

// ---------------------------------------------------------------------------
// Issue 044: @model directive drives the context model type
// ---------------------------------------------------------------------------

describe('044: @model from Controller.action', () => {
  const CTRL = 'apps/web/src/controllers/TodoController.ts';
  const VIEW = 'apps/web/src/views/todo/detail.tmvc';

  it('imports the named controller and types via TypedViewContext', () => {
    const src = '@model from TodoController.detail\n<h1>${context.model.text}</h1>';
    const { code } = generateVirtualTs(src, VIEW, CTRL);
    expect(code).toContain("import type { TodoController as __OwnerController }");
    expect(code).toContain('TypedViewContext<__TmvcData>');
  });

  it('uses the directive action, not the filename, and uses indexed access', () => {
    // File is index.tmvc but the directive names a different action (detail).
    const src = '@model from TodoController.detail\n<h1>x</h1>';
    const { code } = generateVirtualTs(src, 'apps/web/src/views/todo/index.tmvc', CTRL);
    expect(code).toContain("InstanceType<typeof __OwnerController>['detail']");
    // Indexed access on the directive action, not the filename-derived "index".
    expect(code).not.toContain("['index']");
    expect(code).not.toContain('{ index(...args');
  });

  it('the directive markup body is whited out (no @model in generated code)', () => {
    const src = '@model from TodoController.detail\n<h1>x</h1>';
    const { code } = generateVirtualTs(src, VIEW, CTRL);
    expect(code).not.toContain('@model');
  });
});

describe('044: @model <type-expression>', () => {
  it('emits the raw type verbatim and imports no controller', () => {
    const src = "@model import('../../services/TodoService').Todo\n<h1>x</h1>";
    const { code } = generateVirtualTs(src, 'apps/web/src/views/todo/detail.tmvc', null);
    expect(code).toContain("type __TmvcData = import('../../services/TodoService').Todo;");
    expect(code).toContain('TypedViewContext<__TmvcData>');
    expect(code).not.toContain('__OwnerController');
    expect(code).not.toContain('__ExtractModel');
  });

  it('ignores any supplied controller path for the type form', () => {
    const src = '@model { a: number }\n<h1>x</h1>';
    const { code } = generateVirtualTs(src, 'views/todo/detail.tmvc', 'src/controllers/TodoController.ts');
    expect(code).toContain('type __TmvcData = { a: number };');
    expect(code).not.toContain('__OwnerController');
  });
});

describe('044: precedence and no-directive fallback', () => {
  it('without a directive, convention behavior is unchanged (structural match)', () => {
    const { code } = generateVirtualTs(
      '<h1>x</h1>',
      'views/users/index.tmvc',
      'src/controllers/UsersController.ts',
    );
    expect(code).toContain('{ index(...args: any[]): infer R }');
    expect(code).not.toContain('@model');
  });
});

describe('044: getControllerCandidatePathsByName', () => {
  it('builds workspace-root candidates for an explicit name', () => {
    const candidates = getControllerCandidatePathsByName('FooController', 'views/x/y.tmvc', '/ws');
    expect(candidates.every((p) => p.includes('FooController.ts'))).toBe(true);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it('adds a sibling-of-views candidate for sub-project layouts', () => {
    const candidates = getControllerCandidatePathsByName(
      'TodoController',
      '/ws/apps/web/src/views/todo/detail.tmvc',
      '/ws',
    );
    expect(candidates.some((p) =>
      p.replace(/\\/g, '/').endsWith('apps/web/src/controllers/TodoController.ts'),
    )).toBe(true);
  });

  it('returns empty for an empty controller name', () => {
    expect(getControllerCandidatePathsByName('', 'views/x/y.tmvc', '/ws')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Issue 045: @props typed component props
// ---------------------------------------------------------------------------

describe('045: @props typed component props', () => {
  it('emits a typed props parameter from the directive', () => {
    const src = '@props { label: string; value: number }\n<span>${props.label}</span>';
    const { code } = generateVirtualTs(src, 'src/components/StatBadge.tmvc', null);
    expect(code).toContain('type __TmvcProps = { label: string; value: number } & { readonly children?: Fragment };');
    expect(code).toContain('function render(props: __TmvcProps)');
    expect(code).not.toContain('@props');
  });

  it('types children as Fragment even without @props', () => {
    const { code } = generateVirtualTs('<span>${props.children}</span>', 'src/components/Bare.tmvc', null);
    expect(code).toContain('{ readonly children?: Fragment } & Record<string, unknown>');
  });

  it('accepts a raw import() props type', () => {
    const src = "@props import('../models/BadgeProps').BadgeProps\n<span>x</span>";
    const { code } = generateVirtualTs(src, 'src/components/StatBadge.tmvc', null);
    expect(code).toContain("type __TmvcProps = import('../models/BadgeProps').BadgeProps & { readonly children?: Fragment };");
  });
});

// ---------------------------------------------------------------------------
// Issue 046: component call-site prop checking
// ---------------------------------------------------------------------------

describe('046: scanComponentUsages', () => {
  it('captures component name, expression props, and children flag', () => {
    const usages = scanComponentUsages(
      '<StatBadge value="${ctx.n}" label="total" /><Panel title="x">body</Panel>',
    );
    expect(usages.map((u) => u.name)).toEqual(['StatBadge', 'Panel']);
    expect(usages[0]?.hasChildren).toBe(false);
    expect(usages[1]?.hasChildren).toBe(true);
    const valueProp = usages[0]?.props.find((p) => p.name === 'value');
    expect(valueProp?.valueJs).toBe('(ctx.n)');
  });

  it('does not scan tags inside ${...} expressions', () => {
    const usages = scanComponentUsages("${cond ? '<StatBadge />' : ''}");
    expect(usages).toHaveLength(0);
  });
});

describe('046: getComponentCandidatePathsByName', () => {
  it('searches component directories for <Name>.tmvc', () => {
    const candidates = getComponentCandidatePathsByName('StatBadge', 'views/home/index.tmvc', '/ws');
    expect(candidates.every((p) => p.includes('StatBadge.tmvc'))).toBe(true);
    expect(candidates.some((p) => p.replace(/\\/g, '/').includes('components/StatBadge.tmvc'))).toBe(true);
  });

  it('adds a sibling-of-views candidate for sub-project layouts', () => {
    const candidates = getComponentCandidatePathsByName(
      'StatBadge',
      '/ws/apps/web/src/views/home/index.tmvc',
      '/ws',
    );
    expect(candidates.some((p) =>
      p.replace(/\\/g, '/').endsWith('apps/web/src/components/StatBadge.tmvc'),
    )).toBe(true);
  });
});

describe('046: generateVirtualTs emits component imports and checks', () => {
  const imports = new Map([
    ['StatBadge', './components/StatBadge.tmvc'],
    ['Panel', './components/Panel.tmvc'],
  ]);
  const src = '<StatBadge value="${context.model.total}" label="total" /><Panel title="x">body</Panel>';

  it('imports each used component and emits a typed check call', () => {
    const { code } = generateVirtualTs(src, 'src/views/home/index.tmvc', null, imports);
    expect(code).toContain("import __Cmp_StatBadge from './components/StatBadge.tmvc';");
    expect(code).toContain('__Cmp_StatBadge({ value: (context.model.total), label: "total" });');
    expect(code).toContain('__Cmp_Panel({ title: "x", children: (undefined as unknown as Fragment) });');
  });

  // Reads the generated and source substrings for a mapping's first segment.
  const mapSlices = (code: string, m: { sourceOffsets: readonly number[]; generatedOffsets: readonly number[]; lengths: readonly number[] }, src: string) => {
    const g = m.generatedOffsets[0] ?? 0;
    const s = m.sourceOffsets[0] ?? 0;
    const len = m.lengths[0] ?? 0;
    return { gen: code.slice(g, g + len), srcSub: src.slice(s, s + len) };
  };

  it('maps each expression prop equal-length to its source expression', () => {
    const { code, extraMappings } = generateVirtualTs(src, 'src/views/home/index.tmvc', null, imports);
    const exprMap = extraMappings.find((m) => mapSlices(code, m, src).gen === 'context.model.total');
    expect(exprMap).toBeDefined();
    if (exprMap) {
      expect(mapSlices(code, exprMap, src).srcSub).toBe('context.model.total');
    }
  });

  it('maps the component name token for navigation', () => {
    const { code, extraMappings } = generateVirtualTs(src, 'src/views/home/index.tmvc', null, imports);
    const nameMap = extraMappings.find((m) => {
      const { gen, srcSub } = mapSlices(code, m, src);
      return gen === 'StatBadge' && srcSub === 'StatBadge';
    });
    expect(nameMap).toBeDefined();
  });

  it('emits no checks when componentImports is omitted (back-compatible)', () => {
    const { code, extraMappings } = generateVirtualTs(src, 'src/views/home/index.tmvc', null);
    expect(code).not.toContain('__Cmp_');
    expect(extraMappings).toHaveLength(0);
  });

  it('does not check component files themselves', () => {
    const { code } = generateVirtualTs('<StatBadge />', 'src/components/Wrapper.tmvc', null, imports);
    expect(code).not.toContain('__Cmp_');
  });

  it('emits a spread in the prop check', () => {
    const { code } = generateVirtualTs(
      '<StatBadge ...${context.model.badge} />',
      'src/views/home/index.tmvc',
      null,
      new Map([['StatBadge', './components/StatBadge.tmvc']]),
    );
    expect(code).toContain('__Cmp_StatBadge({ ...(context.model.badge) })');
  });
});

// ---------------------------------------------------------------------------
// Issue 046 (mapping): missing-prop errors map to the tag via unequal lengths
// ---------------------------------------------------------------------------

describe('046: unequal-length argument mapping', () => {
  const imports = new Map([['Panel', './components/Panel.tmvc']]);
  const src = '<Panel title="x">body</Panel>';

  it('maps the generated argument object to the source tag name', () => {
    const { code, extraMappings } = generateVirtualTs(src, 'src/views/home/index.tmvc', null, imports);
    const argMap = extraMappings.find((m) => m.generatedLengths !== undefined);
    expect(argMap).toBeDefined();
    if (argMap) {
      const g = argMap.generatedOffsets[0] ?? 0;
      const gl = argMap.generatedLengths?.[0] ?? 0;
      const sl = argMap.lengths[0] ?? 0;
      const s = argMap.sourceOffsets[0] ?? 0;
      expect(code.slice(g, g + gl).startsWith('{ title:')).toBe(true);
      expect(src.slice(s, s + sl)).toBe('Panel');
      // generated length (the object) is longer than the source length (the tag).
      expect(gl).toBeGreaterThan(sl);
    }
  });

  it('keeps equal-length expression and name mappings (no regression)', () => {
    const { extraMappings } = generateVirtualTs(
      '<StatBadge value="${ctx.n}" />',
      'src/views/home/index.tmvc',
      null,
      new Map([['StatBadge', './components/StatBadge.tmvc']]),
    );
    const equal = extraMappings.filter((m) => m.generatedLengths === undefined);
    const unequal = extraMappings.filter((m) => m.generatedLengths !== undefined);
    // name + value expression are equal-length; the argument object is unequal.
    expect(equal.length).toBeGreaterThanOrEqual(2);
    expect(unequal.length).toBe(1);
    // equal-length mappings come before unequal ones (precise positioning wins).
    const firstUnequalIdx = extraMappings.findIndex((m) => m.generatedLengths !== undefined);
    const lastEqualIdx = extraMappings.map((m) => m.generatedLengths === undefined).lastIndexOf(true);
    expect(lastEqualIdx).toBeLessThan(firstUnequalIdx);
  });
});

// ---------------------------------------------------------------------------
// @local block typing, mapping, diagnostics, and grammar
// ---------------------------------------------------------------------------

const COMPONENT_LOCAL =
  '@props { title: string }\n' +
  '@local {\n' +
  '  const open = signal(false);\n' +
  '  const toggle = () => open.update(v => !v);\n' +
  '}\n' +
  '<button onclick="${toggle}">${props.title}</button>';

describe('@local virtual TypeScript', () => {
  const COMP_ID = 'src/components/Accordion.tmvc';

  it('imports the reactivity primitives when a @local block is present (AC1, AC4)', () => {
    const { code } = generateVirtualTs(COMPONENT_LOCAL, COMP_ID, null);
    expect(code).toContain("import { signal, computed, effect, batch, onCleanup } from '@typemvc/core';");
  });

  it('lifts the statements into the render body before return html (AC1)', () => {
    const { code } = generateVirtualTs(COMPONENT_LOCAL, COMP_ID, null);
    const stmtIdx = code.indexOf('const open = signal(false);');
    const retIdx = code.indexOf('  return html`');
    expect(stmtIdx).toBeGreaterThan(-1);
    expect(stmtIdx).toBeLessThan(retIdx);
  });

  it('types props from @props so the block sees the declared shape (AC2)', () => {
    const { code } = generateVirtualTs(COMPONENT_LOCAL, COMP_ID, null);
    expect(code).toContain('type __TmvcProps = { title: string } & { readonly children?: Fragment };');
    expect(code).toContain('render(props: __TmvcProps)');
  });

  it('maps the lifted block region back to the source block region (AC3)', () => {
    const result = generateVirtualTs(COMPONENT_LOCAL, COMP_ID, null);
    expect(result.extraMappings.length).toBeGreaterThanOrEqual(1);
    const mapping = result.extraMappings[result.extraMappings.length - 1];
    const genStart = mapping?.generatedOffsets[0] ?? -1;
    const srcStart = mapping?.sourceOffsets[0] ?? -1;
    const len = mapping?.lengths[0] ?? 0;
    expect(result.code.slice(genStart, genStart + len)).toContain('const open = signal(false);');
    expect(COMPONENT_LOCAL.slice(srcStart, srcStart + len)).toContain('const open = signal(false);');
  });

  it('leaves a component without @local unchanged (AC8)', () => {
    const result = generateVirtualTs('@props { x: number }\n<span>${props.x}</span>', 'src/components/Stat.tmvc', null);
    expect(result.code).not.toContain('signal, computed, effect');
    expect(result.extraMappings).toHaveLength(0);
  });
});

describe('@local diagnostics (AC5, AC6)', () => {
  const COMP_ID = 'src/components/X.tmvc';
  const VIEW_ID = 'src/views/home/index.tmvc';

  it('reports a [TypeMVC] diagnostic for fetch inside a block', () => {
    const diags = getTmvcDiagnostics('@local {\n  const r = fetch("/x");\n}\n<div></div>', COMP_ID);
    const fetchDiag = diags.find((d) => d.message.includes('fetch'));
    expect(fetchDiag?.message).toContain('[TypeMVC]');
    expect(fetchDiag?.message).toContain('controller');
    expect(fetchDiag?.severity).toBe('error');
  });

  it('reports a [TypeMVC] diagnostic for await inside a block', () => {
    const diags = getTmvcDiagnostics('@local {\n  const v = await thing();\n}\n<div></div>', COMP_ID);
    expect(diags.some((d) => d.message.includes('async and await'))).toBe(true);
  });

  it('reports the components-only rule for @local in a view', () => {
    const diags = getTmvcDiagnostics('@local {\n  const a = 1;\n}\n<div></div>', VIEW_ID);
    expect(diags.some((d) => d.message.includes('only allowed in component'))).toBe(true);
  });

  it('returns no diagnostics for a clean component block', () => {
    const diags = getTmvcDiagnostics('@local {\n  const open = signal(false);\n}\n<div></div>', COMP_ID);
    expect(diags).toHaveLength(0);
  });
});

describe('@local grammar highlighting (AC7)', () => {
  const grammar = JSON.parse(
    readFileSync(join(extRoot, 'syntaxes/tmvc.tmLanguage.json'), 'utf-8'),
  ) as {
    patterns: { include?: string }[];
    repository: Record<string, {
      beginCaptures?: Record<string, { name?: string }>;
      contentName?: string;
    }>;
  };

  it('includes the local-block pattern at the top level', () => {
    expect(grammar.patterns.some((p) => p.include === '#local-block')).toBe(true);
  });

  it('scopes @local as a keyword', () => {
    const rule = grammar.repository['local-block'];
    expect(rule?.beginCaptures?.['1']?.name).toContain('keyword');
  });

  it('embeds the block body as TypeScript', () => {
    const rule = grammar.repository['local-block'];
    expect(rule?.contentName).toContain('typescript');
  });
});

// ---------------------------------------------------------------------------
// 060: component call-site checking inside loops
// ---------------------------------------------------------------------------

describe('060: component checking inside ${...} loops', () => {
  const VIEW = 'src/views/home/index.tmvc';
  const imports = new Map([['BookCard', './components/BookCard.tmvc']]);

  it('reproduces the enclosing map with a typed call so props are checked in scope', () => {
    const src = '<ul>${books.map((book) => html`<BookCard book="${book}" />`)}</ul>';
    const { code } = generateVirtualTs(src, VIEW, null, imports);
    expect(code).toContain("import __Cmp_BookCard from './components/BookCard.tmvc';");
    expect(code).toContain('void (books.map((book) => html`${__Cmp_BookCard({ book: (book) })}`));');
  });

  it('preserves the loop variable so it keeps its inferred element type', () => {
    const src = '${items.map((it) => html`<BookCard book="${it.b}" />`)}';
    const { code } = generateVirtualTs(src, VIEW, null, imports);
    expect(code).toContain('items.map((it) => html`${__Cmp_BookCard({ book: (it.b) })}`)');
  });

  it('maps the looped prop expression back to its source offset', () => {
    const src = '${books.map((book) => html`<BookCard book="${book}" />`)}';
    const { code, extraMappings } = generateVirtualTs(src, VIEW, null, imports);
    const m = extraMappings.find(
      (mm) =>
        code.slice(mm.generatedOffsets[0] ?? 0, (mm.generatedOffsets[0] ?? 0) + (mm.lengths[0] ?? 0)) === 'book' &&
        src.slice(mm.sourceOffsets[0] ?? 0, (mm.sourceOffsets[0] ?? 0) + (mm.lengths[0] ?? 0)) === 'book',
    );
    expect(m).toBeDefined();
  });

  it('supports spread on a looped component', () => {
    const src = '${books.map((book) => html`<BookCard ...${book} />`)}';
    const { code } = generateVirtualTs(src, VIEW, null, imports);
    expect(code).toContain('__Cmp_BookCard({ ...(book) })');
  });

  it('checks both a top-level usage and a looped usage', () => {
    const src = '<BookCard book="${first}" />${books.map((book) => html`<BookCard book="${book}" />`)}';
    const { code } = generateVirtualTs(src, VIEW, null, imports);
    expect(code).toContain('__Cmp_BookCard({ book: (first) })');
    expect(code).toContain('void (books.map((book) => html`${__Cmp_BookCard({ book: (book) })}`));');
  });

  it('does not emit loop checks for unresolved components', () => {
    const src = '${books.map((book) => html`<Unknown book="${book}" />`)}';
    const { code } = generateVirtualTs(src, VIEW, null, imports);
    expect(code).not.toContain('__Cmp_Unknown');
    expect(code).not.toContain('void (');
  });
});

describe('060: collectComponentNames', () => {
  it('finds top-level and nested component names', () => {
    const names = collectComponentNames('<A /><ul>${xs.map((x) => html`<B x="${x}" />`)}</ul>');
    expect(names).toContain('A');
    expect(names).toContain('B');
  });

  it('finds deeply nested usages inside nested template literals', () => {
    const names = collectComponentNames(
      '${rows.map((r) => html`<tr>${r.cells.map((c) => html`<Cell v="${c}" />`)}</tr>`)}',
    );
    expect(names).toContain('Cell');
  });

  it('dedupes repeated names', () => {
    expect(collectComponentNames('<A /><A />').filter((n) => n === 'A')).toHaveLength(1);
  });

  it('returns nothing when there are no component tags', () => {
    expect(collectComponentNames('<div>${context.model.x}</div>')).toEqual([]);
  });
});

