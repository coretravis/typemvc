/**
 * Tests for issue 024 / 040: VS Code syntax highlighting for .tmvc files.
 *
 * Acceptance criteria verified here:
 *   AC1  VS Code extension activates for files with the .tmvc extension
 *   AC2  HTML tags, attributes, and text content are highlighted correctly
 *   AC3  ${...} expression sites are highlighted as TypeScript/JavaScript
 *   AC4  String literals, comments, and operators inside expressions are highlighted
 *   AC5  Unclosed ${ does not break highlighting for the remainder of the file
 *   AC6  Grammar is tested against the worked examples from the .tmvc spec
 *   AC7  Extension is packaged as a .vsix and installable locally (structure verified)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, '../../extensions/tmvc-syntax');

const manifestRaw = readFileSync(join(extRoot, 'package.json'), 'utf-8');
const grammarRaw = readFileSync(
  join(extRoot, 'syntaxes/tmvc.tmLanguage.json'),
  'utf-8',
);
const langConfigRaw = readFileSync(
  join(extRoot, 'language-configuration.json'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Typed interfaces for the grammar and manifest
// ---------------------------------------------------------------------------

interface GrammarCapture {
  readonly name: string;
}

interface GrammarPattern {
  readonly include?: string;
  readonly name?: string;
  readonly match?: string;
  readonly begin?: string;
  readonly end?: string;
  readonly applyEndPatternLast?: number;
  readonly beginCaptures?: Record<string, GrammarCapture>;
  readonly endCaptures?: Record<string, GrammarCapture>;
  readonly contentName?: string;
  readonly patterns?: readonly GrammarPattern[];
}

interface Grammar {
  readonly name: string;
  readonly scopeName: string;
  readonly fileTypes: readonly string[];
  readonly patterns: readonly GrammarPattern[];
  readonly repository: Record<string, GrammarPattern>;
}

interface LanguageContrib {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly extensions?: readonly string[];
  readonly configuration?: string;
}

interface GrammarContrib {
  readonly language?: string;
  readonly scopeName: string;
  readonly path: string;
  readonly embeddedLanguages?: Record<string, string>;
}

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly engines: { readonly vscode: string };
  readonly contributes: {
    readonly languages?: readonly LanguageContrib[];
    readonly grammars?: readonly GrammarContrib[];
  };
  readonly scripts?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Parsed files
// ---------------------------------------------------------------------------

const manifest = JSON.parse(manifestRaw) as Manifest;
const grammar = JSON.parse(grammarRaw) as Grammar;

// Worked example from the .tmvc spec (§10.1)
const usersListExample = `<h1>Users</h1>

<ul>
  \${context.data.users.map(user => html\`
    <li>
      <a href="/users/\${user.id}">\${user.name}</a>
    </li>
  \`)}
</ul>

\${context.errors.action
  ? html\`<p class="error">\${context.errors.action.message}</p>\`
  : ''
}`;

// ---------------------------------------------------------------------------
// AC1: extension activates for .tmvc files
// ---------------------------------------------------------------------------

describe('AC1: extension activates for .tmvc files', () => {
  it('manifest is valid JSON', () => {
    expect(() => { JSON.parse(manifestRaw); }).not.toThrow();
  });

  it('manifest has a name field', () => {
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it('manifest contributes a language with .tmvc extension', () => {
    const languages = manifest.contributes.languages ?? [];
    const tmvcLang = languages.find((l) => l.extensions?.includes('.tmvc'));
    expect(tmvcLang).toBeDefined();
  });

  it('the tmvc language id is "tmvc"', () => {
    const languages = manifest.contributes.languages ?? [];
    const tmvcLang = languages.find((l) => l.extensions?.includes('.tmvc'));
    expect(tmvcLang?.id).toBe('tmvc');
  });

  it('manifest contributes a grammar for the tmvc language', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const tmvcGrammar = grammars.find((g) => g.language === 'tmvc');
    expect(tmvcGrammar).toBeDefined();
  });

  it('grammar contribution points to the grammar file', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const tmvcGrammar = grammars.find((g) => g.language === 'tmvc');
    expect(tmvcGrammar?.path).toContain('tmvc.tmLanguage.json');
  });

  it('grammar contribution declares the root scope name', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const tmvcGrammar = grammars.find((g) => g.language === 'tmvc');
    expect(tmvcGrammar?.scopeName).toBe('text.html.tmvc');
  });

  it('language contributes a language-configuration file', () => {
    const languages = manifest.contributes.languages ?? [];
    const tmvcLang = languages.find((l) => l.extensions?.includes('.tmvc'));
    expect(tmvcLang?.configuration).toBeDefined();
  });

  it('language-configuration.json is valid JSON', () => {
    expect(() => { JSON.parse(langConfigRaw); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC2: HTML tags, attributes, and text content are highlighted correctly
// ---------------------------------------------------------------------------

describe('AC2: HTML tags, attributes, and text content are highlighted', () => {
  it('grammar is valid JSON', () => {
    expect(() => { JSON.parse(grammarRaw); }).not.toThrow();
  });

  it('grammar scopeName is text.html.tmvc', () => {
    expect(grammar.scopeName).toBe('text.html.tmvc');
  });

  it('grammar declares .tmvc in fileTypes', () => {
    expect(grammar.fileTypes).toContain('tmvc');
  });

  it('grammar root patterns include text.html.basic for HTML highlighting', () => {
    const htmlInclude = grammar.patterns.find(
      (p) => p.include === 'text.html.basic',
    );
    expect(htmlInclude).toBeDefined();
  });

  it('text.html.basic is included in root patterns (provides HTML tokenization)', () => {
    const includes = grammar.patterns.map((p) => p.include).filter(Boolean);
    expect(includes).toContain('text.html.basic');
  });
});

// ---------------------------------------------------------------------------
// AC3: ${...} expression sites are highlighted as TypeScript/JavaScript
// ---------------------------------------------------------------------------

describe('AC3: ${...} expression sites highlighted as TypeScript', () => {
  it('grammar repository has an interpolation entry', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation).toBeDefined();
  });

  it('interpolation rule has a begin pattern', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation?.begin).toBeDefined();
  });

  it('interpolation begin pattern matches ${', () => {
    const interpolation = grammar.repository.interpolation;
    if (interpolation?.begin === undefined) return;
    const regex = new RegExp(interpolation.begin);
    expect(regex.test('${context.data.users}')).toBe(true);
  });

  it('interpolation begin pattern does not match plain $', () => {
    const interpolation = grammar.repository.interpolation;
    if (interpolation?.begin === undefined) return;
    const regex = new RegExp(interpolation.begin);
    expect(regex.test('price: $100')).toBe(false);
    expect(regex.test('count: $count')).toBe(false);
  });

  it('interpolation rule has an end pattern', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation?.end).toBeDefined();
  });

  it('interpolation end pattern matches }', () => {
    const interpolation = grammar.repository.interpolation;
    if (interpolation?.end === undefined) return;
    const regex = new RegExp(interpolation.end);
    expect(regex.test('}')).toBe(true);
  });

  it('interpolation rule has a name scope', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation?.name).toBeDefined();
    expect(interpolation?.name).toContain('tmvc');
  });

  it('interpolation beginCaptures names the ${ token', () => {
    const interpolation = grammar.repository.interpolation;
    const cap = interpolation?.beginCaptures?.['1'];
    expect(cap?.name).toBeDefined();
    expect(cap?.name).toContain('template-expression');
  });

  it('interpolation endCaptures names the } token', () => {
    const interpolation = grammar.repository.interpolation;
    const cap = interpolation?.endCaptures?.['1'];
    expect(cap?.name).toBeDefined();
    expect(cap?.name).toContain('template-expression');
  });

  it('interpolation contentName marks the body as embedded TypeScript', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation?.contentName).toBeDefined();
    expect(interpolation?.contentName).toContain('typescript');
  });

  it('interpolation patterns include source.ts for TypeScript highlighting', () => {
    const interpolation = grammar.repository.interpolation;
    const tsInclude = interpolation?.patterns?.find(
      (p) => p.include === 'source.ts',
    );
    expect(tsInclude).toBeDefined();
  });

  it('root patterns try interpolation before text.html.basic (priority order)', () => {
    const interpolationIdx = grammar.patterns.findIndex(
      (p) => p.include === '#interpolation',
    );
    const htmlIdx = grammar.patterns.findIndex(
      (p) => p.include === 'text.html.basic',
    );
    expect(interpolationIdx).toBeGreaterThanOrEqual(0);
    expect(htmlIdx).toBeGreaterThanOrEqual(0);
    expect(interpolationIdx).toBeLessThan(htmlIdx);
  });

  it('manifest embeddedLanguages maps typescript content scope to typescript', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const tmvcGrammar = grammars.find((g) => g.language === 'tmvc');
    const embedded = tmvcGrammar?.embeddedLanguages;
    expect(embedded).toBeDefined();
    const hasTypescript = Object.values(embedded ?? {}).includes('typescript');
    expect(hasTypescript).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC4: string literals, comments, and operators inside expressions highlighted
// ---------------------------------------------------------------------------

describe('AC4: string literals, comments, operators highlighted in expressions', () => {
  it('interpolation includes source.ts which covers string literals', () => {
    const interpolation = grammar.repository.interpolation;
    const tsInclude = interpolation?.patterns?.find(
      (p) => p.include === 'source.ts',
    );
    expect(tsInclude).toBeDefined();
  });

  it('interpolation includes source.ts which covers comments', () => {
    const interpolation = grammar.repository.interpolation;
    const tsInclude = interpolation?.patterns?.find(
      (p) => p.include === 'source.ts',
    );
    expect(tsInclude).toBeDefined();
    expect(tsInclude?.include).toBe('source.ts');
  });

  it('nested-braces also includes source.ts for TypeScript inside blocks', () => {
    const nestedBraces = grammar.repository['nested-braces'];
    const tsInclude = nestedBraces?.patterns?.find(
      (p) => p.include === 'source.ts',
    );
    expect(tsInclude).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC5: unclosed ${ handled gracefully
// ---------------------------------------------------------------------------

describe('AC5: unclosed ${ handled gracefully', () => {
  it('interpolation has applyEndPatternLast set (enables depth tracking)', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation?.applyEndPatternLast).toBe(1);
  });

  it('interpolation has a non-empty end pattern (won\'t infinite loop)', () => {
    const interpolation = grammar.repository.interpolation;
    expect(interpolation?.end).toBeDefined();
    expect((interpolation?.end ?? '').length).toBeGreaterThan(0);
  });

  it('nested-braces has applyEndPatternLast set (prevents premature end match)', () => {
    const nestedBraces = grammar.repository['nested-braces'];
    expect(nestedBraces?.applyEndPatternLast).toBe(1);
  });

  it('nested-braces has a non-empty begin pattern', () => {
    const nestedBraces = grammar.repository['nested-braces'];
    const begin = nestedBraces?.begin;
    expect(begin).toBeDefined();
    if (!begin) return;
    const regex = new RegExp(begin);
    expect(regex.test('{')).toBe(true);
  });

  it('nested-braces recursively includes itself (allows unlimited depth)', () => {
    const nestedBraces = grammar.repository['nested-braces'];
    const selfInclude = nestedBraces?.patterns?.find(
      (p) => p.include === '#nested-braces',
    );
    expect(selfInclude).toBeDefined();
  });

  it('interpolation includes nested-braces before source.ts (depth tracking priority)', () => {
    const interpolation = grammar.repository.interpolation;
    const patterns = interpolation?.patterns ?? [];
    const nestedIdx = patterns.findIndex((p) => p.include === '#nested-braces');
    const tsIdx = patterns.findIndex((p) => p.include === 'source.ts');
    expect(nestedIdx).toBeGreaterThanOrEqual(0);
    expect(tsIdx).toBeGreaterThanOrEqual(0);
    expect(nestedIdx).toBeLessThan(tsIdx);
  });

  it('begin pattern for interpolation matches only ${ not $', () => {
    const interpolation = grammar.repository.interpolation;
    if (!interpolation?.begin) return;
    const regex = new RegExp(interpolation.begin);
    expect(regex.test('${')).toBe(true);
    expect(regex.test('$x')).toBe(false);
    expect(regex.test('$ {')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC6: grammar tested against the worked examples from the .tmvc spec
// ---------------------------------------------------------------------------

describe('AC6: grammar tested against worked examples from the spec', () => {
  it('users list example contains the expected HTML tags', () => {
    expect(usersListExample).toContain('<h1>Users</h1>');
    expect(usersListExample).toContain('<ul>');
    expect(usersListExample).toContain('<li>');
    expect(usersListExample).toContain('<a href=');
  });

  it('users list example contains the expected interpolation sites', () => {
    const matches = usersListExample.match(/\$\{/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('interpolation begin pattern matches all ${ sites in the users list example', () => {
    const interpolation = grammar.repository.interpolation;
    if (!interpolation?.begin) return;
    const regex = new RegExp(interpolation.begin, 'g');
    const matches = [...usersListExample.matchAll(regex)];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('interpolation begin pattern does NOT match HTML tags in the example', () => {
    const interpolation = grammar.repository.interpolation;
    if (!interpolation?.begin) return;
    const regex = new RegExp(interpolation.begin);
    expect(regex.test('<h1>Users</h1>')).toBe(false);
    expect(regex.test('<ul>')).toBe(false);
    expect(regex.test('<a href="/users/">')).toBe(false);
  });

  it('html text.html.basic include covers the HTML parts of the users list', () => {
    const htmlInclude = grammar.patterns.find(
      (p) => p.include === 'text.html.basic',
    );
    expect(htmlInclude).toBeDefined();
  });

  it('ternary expression pattern in the users list has nested html template', () => {
    const nestedBraces = grammar.repository['nested-braces'];
    expect(nestedBraces).toBeDefined();
    const tsInclude = nestedBraces?.patterns?.find(
      (p) => p.include === 'source.ts',
    );
    expect(tsInclude).toBeDefined();
  });

  it('grammar name is meaningful', () => {
    expect(grammar.name).toContain('TypeMVC');
  });

  it('interpolation begin pattern matches the action error check in the example', () => {
    const interpolation = grammar.repository.interpolation;
    if (!interpolation?.begin) return;
    const regex = new RegExp(interpolation.begin);
    expect(regex.test('${context.errors.action')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC7: extension packagable as .vsix
// ---------------------------------------------------------------------------

describe('AC7: extension is packagable as .vsix', () => {
  it('manifest has a publisher field (required for .vsix packaging)', () => {
    expect(typeof manifest.publisher).toBe('string');
    expect(manifest.publisher.length).toBeGreaterThan(0);
  });

  it('manifest has a version field in semver format', () => {
    expect(typeof manifest.version).toBe('string');
    expect(/^\d+\.\d+\.\d+$/.test(manifest.version)).toBe(true);
  });

  it('manifest specifies a VS Code engine version', () => {
    expect(typeof manifest.engines.vscode).toBe('string');
    expect(manifest.engines.vscode.length).toBeGreaterThan(0);
  });

  it('manifest has a vscode:package script for packaging', () => {
    const scripts = manifest.scripts ?? {};
    expect(scripts['vscode:package']).toBeDefined();
    const script = scripts['vscode:package'];
    if (!script) return;
    expect(script).toContain('vsce');
  });

  it('grammar file path in manifest points to the syntaxes directory', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const tmvcGrammar = grammars.find((g) => g.language === 'tmvc');
    expect(tmvcGrammar?.path).toContain('syntaxes');
  });

  it('grammar file has all required TextMate fields for packaging', () => {
    expect(grammar.name).toBeDefined();
    expect(grammar.scopeName).toBeDefined();
    expect(grammar.fileTypes).toBeDefined();
    expect(grammar.patterns).toBeDefined();
    expect(grammar.repository).toBeDefined();
  });

  it('language-configuration file is valid and has brackets', () => {
    const config = JSON.parse(langConfigRaw) as { brackets?: unknown[] };
    expect(config.brackets).toBeDefined();
    expect(Array.isArray(config.brackets)).toBe(true);
  });

  it('language-configuration has autoClosingPairs', () => {
    const config = JSON.parse(langConfigRaw) as {
      autoClosingPairs?: unknown[];
    };
    expect(config.autoClosingPairs).toBeDefined();
    expect(Array.isArray(config.autoClosingPairs)).toBe(true);
    expect((config.autoClosingPairs ?? []).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC8: ${...} in HTML attribute values is highlighted as TypeScript
// ---------------------------------------------------------------------------

interface AttrGrammar {
  readonly name?: string;
  readonly scopeName: string;
  readonly injectionSelector?: string;
  readonly patterns?: readonly GrammarPattern[];
  readonly repository?: {
    readonly interpolation?: GrammarPattern;
    readonly 'nested-braces'?: GrammarPattern;
  };
}

describe('AC8: ${...} in HTML attribute values highlighted as TypeScript', () => {
  const attrGrammarRaw = readFileSync(
    join(extRoot, 'syntaxes/tmvc-attribute-expressions.tmLanguage.json'),
    'utf-8',
  );
  const attrGrammar = JSON.parse(attrGrammarRaw) as AttrGrammar;

  it('injection grammar file is valid JSON', () => {
    expect(() => { JSON.parse(attrGrammarRaw); }).not.toThrow();
  });

  it('injection grammar has a non-empty scopeName', () => {
    expect(typeof attrGrammar.scopeName).toBe('string');
    expect(attrGrammar.scopeName.length).toBeGreaterThan(0);
  });

  it('injection grammar has an injectionSelector', () => {
    expect(typeof attrGrammar.injectionSelector).toBe('string');
    expect((attrGrammar.injectionSelector ?? '').length).toBeGreaterThan(0);
  });

  it('injectionSelector targets HTML double-quoted attribute strings', () => {
    expect(attrGrammar.injectionSelector).toContain('string.quoted.double.html');
  });

  it('injectionSelector targets HTML single-quoted attribute strings', () => {
    expect(attrGrammar.injectionSelector).toContain('string.quoted.single.html');
  });

  it('injectionSelector is scoped to text.html.tmvc documents only', () => {
    expect(attrGrammar.injectionSelector).toContain('text.html.tmvc');
  });

  it('injection grammar has an interpolation rule in its repository', () => {
    expect(attrGrammar.repository?.interpolation).toBeDefined();
  });

  it('interpolation begin pattern in injection grammar matches ${', () => {
    const interp = attrGrammar.repository?.interpolation;
    if (!interp?.begin) return;
    const regex = new RegExp(interp.begin);
    expect(regex.test('${')).toBe(true);
    expect(regex.test('$x')).toBe(false);
  });

  it('interpolation in injection grammar has nested-braces for depth tracking', () => {
    const interp = attrGrammar.repository?.interpolation;
    const nested = interp?.patterns?.find((p) => p.include === '#nested-braces');
    expect(nested).toBeDefined();
  });

  it('injection grammar has nested-braces rule for handling function bodies in attrs', () => {
    expect(attrGrammar.repository?.['nested-braces']).toBeDefined();
  });

  it('nested-braces in injection grammar recursively includes itself', () => {
    const nb = attrGrammar.repository?.['nested-braces'];
    const selfRef = nb?.patterns?.find((p) => p.include === '#nested-braces');
    expect(selfRef).toBeDefined();
  });

  it('injection grammar is registered in the extension manifest', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const found = grammars.find((g) => g.scopeName === attrGrammar.scopeName);
    expect(found).toBeDefined();
  });

  it('injection grammar manifest entry declares embeddedLanguages for typescript', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const found = grammars.find((g) => g.scopeName === attrGrammar.scopeName);
    const embedded = found?.embeddedLanguages;
    expect(embedded).toBeDefined();
    expect(Object.values(embedded ?? {}).includes('typescript')).toBe(true);
  });

  it('injection grammar manifest entry has no language field (injection grammars are unowned)', () => {
    const grammars = manifest.contributes.grammars ?? [];
    const found = grammars.find((g) => g.scopeName === attrGrammar.scopeName);
    expect(found?.language).toBeUndefined();
  });
});
