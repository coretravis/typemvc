/**
 * Tests for issue
 */

import { describe, it, expect } from 'vitest';
import {
  transformTmvc,
  validateTmvcSource,
  rewriteComponentTags,
} from '../../src/vite-plugin/index.js';

const VIEW_ID = '/src/views/home/index.tmvc';
const COMPONENT_ID = '/src/components/Drawer.tmvc';

// Blanks every HTML comment by hand, preserving newlines: the baseline a comment
// stripping transform must reproduce exactly.
function blankComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/gu, (m) => m.replace(/[^\n]/gu, ' '));
}

// ---------------------------------------------------------------------------
// AC8: comments are stripped from the generated template, nothing else moves
// ---------------------------------------------------------------------------

describe('HTML comment stripping in transformTmvc', () => {
  const source = [
    '<div class="wrap">',
    '  <!-- Toggling a',
    '  class rather than rebuilding it keeps one nav -->',
    '  <p>${context.data.name}</p>',
    '  <a href="/u/${context.data.id}">go</a>',
    '</div>',
  ].join('\n');

  it('removes the comment text from the generated html literal', () => {
    const { code } = transformTmvc(source, VIEW_ID);
    expect(code).not.toContain('<!--');
    expect(code).not.toContain('Toggling');
  });

  it('leaves the surrounding markup and holes untouched', () => {
    const { code } = transformTmvc(source, VIEW_ID);
    expect(code).toContain('<div class="wrap">');
    expect(code).toContain('<p>${context.data.name}</p>');
    expect(code).toContain('<a href="/u/${context.data.id}">go</a>');
  });

  it('produces the same code as the same source with the comment blanked', () => {
    const withComments = transformTmvc(source, VIEW_ID);
    const baseline = transformTmvc(blankComments(source), VIEW_ID);
    expect(withComments.code).toBe(baseline.code);
  });

  it('preserves the line count and the source map mappings', () => {
    const withComments = transformTmvc(source, VIEW_ID);
    const baseline = transformTmvc(blankComments(source), VIEW_ID);

    const map = JSON.parse(withComments.map) as {
      mappings: string;
      sourcesContent: string[];
    };
    const baseMap = JSON.parse(baseline.map) as { mappings: string };

    expect(withComments.code.split('\n')).toHaveLength(baseline.code.split('\n').length);
    expect(map.mappings).toBe(baseMap.mappings);
    expect(map.sourcesContent[0]).toBe(source);
  });

  it('removes a hole that sits inside a comment', () => {
    const { code } = transformTmvc('<!-- ${context.data.secret} -->\n<p>ok</p>', VIEW_ID);
    expect(code).not.toContain('context.data.secret');
    expect(code).toContain('<p>ok</p>');
  });

  it('does not strip a "<!--" that sits inside an expression string', () => {
    const { code } = transformTmvc("<p>${'<!-- literal -->'}</p>", VIEW_ID);
    expect(code).toContain("${'<!-- literal -->'}");
  });

  it('does not rewrite a component tag that is commented out', () => {
    const { code } = transformTmvc('<!-- <Pill label="x" /> -->\n<p>ok</p>', VIEW_ID);
    expect(code).not.toContain("_callComponent('Pill'");
    expect(code).toContain('<p>ok</p>');
  });
});

// ---------------------------------------------------------------------------
// AC9: markup checks are blind to HTML comments
// ---------------------------------------------------------------------------

describe('validateTmvcSource ignores HTML comments', () => {
  it('accepts a comment continuation line beginning with "class"', () => {
    const source = [
      '<nav>',
      '  <!-- Toggling a',
      '  class rather than rebuilding it keeps one nav -->',
      '</nav>',
    ].join('\n');
    expect(validateTmvcSource(source, VIEW_ID)).toEqual([]);
  });

  it('accepts a comment continuation line beginning with "import" or "export"', () => {
    const source = [
      '<!-- notes:',
      'import the icons from the design system, then',
      'export them again from the barrel -->',
      '<p>ok</p>',
    ].join('\n');
    expect(validateTmvcSource(source, VIEW_ID)).toEqual([]);
  });

  it('accepts a single-line comment mentioning a class definition', () => {
    expect(validateTmvcSource('<!-- class Foo {} -->\n<p>ok</p>', VIEW_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC10, AC11, AC13: the @local denylist is blind to comments and literals
// ---------------------------------------------------------------------------

describe('@local denylist masking', () => {
  it('accepts line and block comments holding denied words', () => {
    const source = [
      '@local {',
      '  // we fetch nothing here',
      '  // wait, do not await anything',
      '  /* no import, no export,',
      '     and nothing async */',
      '  const open = signal(false);',
      '}',
      '<div>${open.get()}</div>',
    ].join('\n');
    expect(validateTmvcSource(source, COMPONENT_ID)).toEqual([]);
  });

  it('accepts string and template literals holding denied words', () => {
    const source = [
      '@local {',
      "  const msg = 'we do not import here';",
      '  const other = "nothing to export";',
      '  const tpl = `no fetch and no await in here`;',
      '}',
      '<p>${msg}${other}${tpl}</p>',
    ].join('\n');
    expect(validateTmvcSource(source, COMPONENT_ID)).toEqual([]);
  });

  it('still sees code inside a template literal hole', () => {
    const source = ['@local {', '  const t = `x ${fetch()} y`;', '}', '<p>ok</p>'].join('\n');
    const errors = validateTmvcSource(source, COMPONENT_ID);
    expect(errors.map((e) => e.kind)).toEqual(['local-fetch']);
  });

  it('accepts identifiers that merely contain a denied word', () => {
    const source = [
      '@local {',
      '  const fetchCount = signal(0);',
      '  const prefetch = () => fetchCount.update((n) => n + 1);',
      '  const importantFlag = true;',
      '}',
      '<p>${importantFlag}</p>',
    ].join('\n');
    expect(validateTmvcSource(source, COMPONENT_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC12, AC14: real violations still fail, with the author's own line
// ---------------------------------------------------------------------------

describe('real violations still fail (AC12, AC14)', () => {
  it('reports a real import in the markup body', () => {
    const source = ['<!-- header -->', 'import { x } from "y";', '<p>ok</p>'].join('\n');
    expect(validateTmvcSource(source, VIEW_ID)).toEqual([
      { kind: 'import-statement', line: 2, source: 'import { x } from "y";' },
    ]);
  });

  it('reports a real export in the markup body', () => {
    const source = ['<p>ok</p>', 'export const a = 1;'].join('\n');
    expect(validateTmvcSource(source, VIEW_ID)).toEqual([
      { kind: 'export-statement', line: 2, source: 'export const a = 1;' },
    ]);
  });

  it('reports a real class definition in the markup body', () => {
    const source = ['<!-- a note -->', 'class Widget {}', '<p>ok</p>'].join('\n');
    expect(validateTmvcSource(source, VIEW_ID)).toEqual([
      { kind: 'class-definition', line: 2, source: 'class Widget {}' },
    ]);
  });

  it('reports a real fetch inside @local with the original source line', () => {
    const source = [
      '@local {',
      "  const rows = fetch('/api/rows'); // grab them",
      '}',
      '<p>ok</p>',
    ].join('\n');
    expect(validateTmvcSource(source, COMPONENT_ID)).toEqual([
      {
        kind: 'local-fetch',
        line: 2,
        source: "  const rows = fetch('/api/rows'); // grab them",
      },
    ]);
  });

  it('reports a real async and await inside @local', () => {
    const source = [
      '@local {',
      '  const load = async () => {',
      '    const r = await go();',
      '  };',
      '}',
      '<p>ok</p>',
    ].join('\n');
    const errors = validateTmvcSource(source, COMPONENT_ID);
    expect(errors.map((e) => ({ kind: e.kind, line: e.line }))).toEqual([
      { kind: 'local-async', line: 2 },
      { kind: 'local-async', line: 3 },
    ]);
  });

  it('reports a real import and export inside @local', () => {
    const source = [
      '@local {',
      "  import x from 'y';",
      '  export const a = 1;',
      '}',
      '<p>ok</p>',
    ].join('\n');
    const errors = validateTmvcSource(source, COMPONENT_ID);
    expect(errors.map((e) => ({ kind: e.kind, line: e.line }))).toEqual([
      { kind: 'local-import', line: 2 },
      { kind: 'local-export', line: 3 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC18: the runtime parser path calls the validator without an id
// ---------------------------------------------------------------------------

describe('validator without an id (AC18)', () => {
  it('skips the component-only check but keeps the denylist', () => {
    const source = ['@local {', "  const r = fetch('/x');", '}', '<p>ok</p>'].join('\n');
    const errors = validateTmvcSource(source);
    expect(errors.map((e) => e.kind)).toEqual(['local-fetch']);
  });

  it('accepts a commented denied word without an id', () => {
    const source = ['@local {', '  // no fetch here', '}', '<p>ok</p>'].join('\n');
    expect(validateTmvcSource(source)).toEqual([]);
  });

  it('accepts a clean view without an id', () => {
    expect(validateTmvcSource('<!-- class notes -->\n<p>${context.data.x}</p>')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC15, AC16: entity decoding in component attributes
// ---------------------------------------------------------------------------

describe('component attribute entity decoding (AC15)', () => {
  it('decodes a named reference in a static attribute', () => {
    expect(rewriteComponentTags('<Pill title="A &amp; B" />')).toContain(
      '_callComponent(\'Pill\', { title: "A & B" })',
    );
  });

  it('decodes the core named references', () => {
    const out = rewriteComponentTags(
      '<Pill a="&lt;" b="&gt;" c="&quot;" d="&#39;" e="&apos;" f="&nbsp;" />',
    );
    expect(out).toContain('a: "<"');
    expect(out).toContain('b: ">"');
    expect(out).toContain('c: "\\""');
    expect(out).toContain('d: "\'"');
    expect(out).toContain('e: "\'"');
    expect(out).toContain('f: "\u00a0"');
  });

  it('decodes decimal and hex numeric references', () => {
    const out = rewriteComponentTags('<Pill dec="&#38;" hex="&#x26;" />');
    expect(out).toContain('dec: "&"');
    expect(out).toContain('hex: "&"');
  });

  it('leaves an unrecognised entity as written', () => {
    expect(rewriteComponentTags('<Pill title="&notreal;" />')).toContain('title: "&notreal;"');
  });

  it('leaves a bare ampersand as written', () => {
    expect(rewriteComponentTags('<Pill title="A & B" />')).toContain('title: "A & B"');
  });

  it('decodes through the full transform', () => {
    const { code } = transformTmvc('<Pill title="A &amp; B" />', VIEW_ID);
    expect(code).toContain('title: "A & B"');
  });
});

describe('component attribute expressions are unchanged (AC16)', () => {
  it('passes an expression containing an ampersand through verbatim', () => {
    expect(rewriteComponentTags('<Pill checked="${a && b}" />')).toContain(
      "_callComponent('Pill', { checked: a && b })",
    );
  });

  it('passes an array literal expression through verbatim', () => {
    expect(rewriteComponentTags("<RadioGroup options=\"${['A','B']}\" />")).toContain(
      "options: ['A','B']",
    );
  });

  it('decodes only the literal segments of a mixed value', () => {
    const out = rewriteComponentTags('<Pill class="a &amp; ${cls}" />');
    expect(out).toContain('class: `a & ${cls}`');
  });

  it('does not turn a decoded dollar brace into a live expression', () => {
    const out = rewriteComponentTags('<Pill class="&#36;{evil} ${cls}" />');
    expect(out).toContain('class: `\\${evil} ${cls}`');
  });

  it('leaves a boolean attribute alone', () => {
    expect(rewriteComponentTags('<Pill disabled />')).toContain('disabled: true');
  });
});
