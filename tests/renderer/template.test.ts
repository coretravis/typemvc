import { describe, it, expect } from 'vitest';
import { buildRawHtml, splitAttrValue } from '../../src/renderer/template.js';

// Returns the TemplateStringsArray so buildRawHtml can be exercised directly.
// The interpolated values are irrelevant; only the static strings drive markers.
function tsa(strings: TemplateStringsArray, ...values: unknown[]): TemplateStringsArray {
  void values;
  return strings;
}

// ---------------------------------------------------------------------------
// buildRawHtml: node vs attribute hole classification
// ---------------------------------------------------------------------------

describe('buildRawHtml hole classification', () => {
  it('classifies a whole-value attribute hole as an attribute token', () => {
    const raw = buildRawHtml(tsa`<a href="${'/x'}">x</a>`);
    expect(raw).toContain('__tmvc_ba0__');
    expect(raw).not.toContain('<!--');
  });

  it('classifies an attribute hole with a literal prefix as an attribute token', () => {
    const raw = buildRawHtml(tsa`<a href="/books/${'1'}">x</a>`);
    expect(raw).toContain('href="/books/__tmvc_ba0__"');
    expect(raw).not.toContain('<!--');
  });

  it('classifies multiple holes in one attribute value', () => {
    const raw = buildRawHtml(tsa`<div class="${'a'} ${'b'}"></div>`);
    expect(raw).toContain('class="__tmvc_ba0__ __tmvc_ba1__"');
  });

  it('classifies an unquoted attribute hole as an attribute token', () => {
    const raw = buildRawHtml(tsa`<input value=${'x'}>`);
    expect(raw).toContain('__tmvc_ba0__');
    expect(raw).not.toContain('<!--');
  });

  it('classifies a node hole as a comment marker', () => {
    const raw = buildRawHtml(tsa`<p>${'hi'}</p>`);
    expect(raw).toContain('<!--__tmvc_b0__-->');
    expect(raw).not.toContain('__tmvc_ba0__');
  });

  it('classifies holes in both positions in one template', () => {
    const raw = buildRawHtml(tsa`<a href="/u/${'1'}">${'name'}</a>`);
    expect(raw).toContain('href="/u/__tmvc_ba0__"');
    expect(raw).toContain('<!--__tmvc_b1__-->');
  });
});

// ---------------------------------------------------------------------------
// splitAttrValue
// ---------------------------------------------------------------------------

describe('splitAttrValue', () => {
  it('returns null for a value with no holes', () => {
    expect(splitAttrValue('plain')).toBeNull();
  });

  it('splits a literal prefix and a hole', () => {
    expect(splitAttrValue('/books/__tmvc_ba0__')).toEqual([
      { kind: 'literal', text: '/books/' },
      { kind: 'hole', index: 0 },
    ]);
  });

  it('splits multiple holes with a literal between them', () => {
    expect(splitAttrValue('__tmvc_ba0__ __tmvc_ba1__')).toEqual([
      { kind: 'hole', index: 0 },
      { kind: 'literal', text: ' ' },
      { kind: 'hole', index: 1 },
    ]);
  });

  it('returns a single hole for a whole-value token', () => {
    expect(splitAttrValue('__tmvc_ba3__')).toEqual([{ kind: 'hole', index: 3 }]);
  });
});
