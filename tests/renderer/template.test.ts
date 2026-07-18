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

describe('buildRawHtml comment mode', () => {
  it('leaves a later node hole intact after a comment containing an apostrophe', () => {
    const raw = buildRawHtml(tsa`<!-- the topbar's switcher -->
<p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
    expect(raw).not.toContain('__tmvc_ba0__');
  });

  it('leaves a later node hole intact after a comment containing a double quote', () => {
    const raw = buildRawHtml(tsa`<!-- the "topbar" switcher -->
<p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
  });

  it('leaves a later node hole intact after a comment containing = and <', () => {
    const raw = buildRawHtml(tsa`<!-- use class="x" when a < b -->
<p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
    expect(raw).not.toContain('__tmvc_ba0__');
  });

  it('leaves a later attribute hole classified as an attribute hole', () => {
    const raw = buildRawHtml(tsa`<!-- the topbar's switcher -->
<a href="${'/x'}">x</a>`);
    expect(raw).toContain('href="__tmvc_ba0__"');
  });

  it('handles an unbalanced quote count across several comments', () => {
    const raw = buildRawHtml(tsa`<!-- it's -->
<!-- "half quoted -->
<!-- don't -->
<p>${'A'}</p><i>${'B'}</i>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
    expect(raw).toContain('<i><!--__tmvc_b1__--></i>');
  });

  it('treats a hole inside a comment as inert and renders nothing for it', () => {
    const raw = buildRawHtml(tsa`<!-- note: ${'SECRET'} -->
<p>${'HELLO'}</p>`);
    expect(raw).not.toContain('__tmvc_b0__');
    expect(raw).not.toContain('__tmvc_ba0__');
    expect(raw).toContain('<!-- note:  -->');
    expect(raw).toContain('<p><!--__tmvc_b1__--></p>');
  });

  it('does not nest a sentinel inside an outer comment', () => {
    const raw = buildRawHtml(tsa`<!-- ${'X'} -->`);
    expect(raw).toBe('<!--  -->');
  });

  it('scans a comment that opens and closes across separate static strings', () => {
    const raw = buildRawHtml(tsa`<div><!-- a ${'X'} b --><span>${'Y'}</span></div>`);
    expect(raw).toBe('<div><!-- a  b --><span><!--__tmvc_b1__--></span></div>');
  });

  it('is not confused by a doctype declaration', () => {
    const raw = buildRawHtml(tsa`<!DOCTYPE html>
<p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
  });

  it('is not confused by a stray "<!" in body text', () => {
    const raw = buildRawHtml(tsa`<p>a <! b</p>
<p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
  });

  it('treats an unterminated comment as running to the end of the template', () => {
    const raw = buildRawHtml(tsa`<p>ok</p><!-- unterminated ${'X'}`);
    expect(raw).not.toContain('__tmvc_b0__');
    expect(raw).not.toContain('__tmvc_ba0__');
  });
});

// ---------------------------------------------------------------------------
// Issue 062: raw text elements (AC5)
// ---------------------------------------------------------------------------

describe('buildRawHtml raw text elements', () => {
  it('throws for a hole inside <textarea> and names the fix', () => {
    expect(() => buildRawHtml(tsa`<textarea>${'v'}</textarea>`)).toThrow(/\[TypeMVC\]/u);
    expect(() => buildRawHtml(tsa`<textarea>${'v'}</textarea>`)).toThrow(/<textarea>/u);
    expect(() => buildRawHtml(tsa`<textarea>${'v'}</textarea>`)).toThrow(/value=/u);
  });

  it('throws for a hole inside <title>', () => {
    expect(() => buildRawHtml(tsa`<title>${'t'}</title>`)).toThrow(/<title>/u);
  });

  it('throws for a hole inside <style>', () => {
    expect(() => buildRawHtml(tsa`<style>.a { color: ${'red'}; }</style>`)).toThrow(/<style>/u);
  });

  it('throws for a hole inside <script>', () => {
    expect(() => buildRawHtml(tsa`<script>const a = ${'1'};</script>`)).toThrow(/<script>/u);
  });

  it('matches the raw text element name case-insensitively', () => {
    expect(() => buildRawHtml(tsa`<TEXTAREA>${'v'}</TEXTAREA>`)).toThrow(/<textarea>/u);
  });

  it('allows a hole in an attribute of a raw text element', () => {
    const raw = buildRawHtml(tsa`<textarea value="${'v'}" rows="3"></textarea>`);
    expect(raw).toContain('value="__tmvc_ba0__"');
  });

  it('leaves holes after a closed raw text element unaffected', () => {
    const raw = buildRawHtml(tsa`<style>.a { color: red; }</style><p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
  });

  it('does not treat a nested non-matching close tag as the end of raw text', () => {
    expect(() => buildRawHtml(tsa`<script>a </b> ${'x'}</script>`)).toThrow(/<script>/u);
  });
});

// ---------------------------------------------------------------------------
// Issue 062 AC17: existing scanner behaviour is unregressed
// ---------------------------------------------------------------------------

describe('buildRawHtml existing classification', () => {
  it('classifies an event hole as an attribute hole', () => {
    const raw = buildRawHtml(tsa`<button onclick=${(): void => undefined}>go</button>`);
    expect(raw).toContain('onclick=__tmvc_ba0__');
  });

  it('classifies a multi-part attribute value with a literal suffix', () => {
    const raw = buildRawHtml(tsa`<div class="btn ${'a'} end"></div>`);
    expect(raw).toContain('class="btn __tmvc_ba0__ end"');
  });

  it('classifies a single-quoted attribute hole as an attribute hole', () => {
    const raw = buildRawHtml(tsa`<div class='${'a'}'></div>`);
    expect(raw).toContain("class='__tmvc_ba0__'");
  });

  it('returns to text mode after an unquoted attribute value', () => {
    const raw = buildRawHtml(tsa`<input value=x><p>${'HELLO'}</p>`);
    expect(raw).toContain('<p><!--__tmvc_b0__--></p>');
  });

  it('classifies a hole in a self-closing tag attribute', () => {
    const raw = buildRawHtml(tsa`<img src="${'/a.png'}" /><p>${'HELLO'}</p>`);
    expect(raw).toContain('src="__tmvc_ba0__"');
    expect(raw).toContain('<p><!--__tmvc_b1__--></p>');
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

// ---------------------------------------------------------------------------
// Prefixed attribute names
//
// The scanner classifies a hole by its position, not by the attribute it sits
// in, so a colon in the name is an ordinary name character. These pin that: a
// prefixed attribute must produce an attribute token, never a node comment.
// ---------------------------------------------------------------------------

describe('buildRawHtml with prefixed attribute names', () => {
  it('classifies a class: hole as an attribute hole', () => {
    const raw = buildRawHtml(tsa`<button class:is-active="${true}">x</button>`);

    expect(raw).toContain('class:is-active="__tmvc_ba0__"');
    expect(raw).not.toContain('<!--');
  });

  it('classifies a style: hole as an attribute hole', () => {
    const raw = buildRawHtml(tsa`<div style:--fill="${'40%'}"></div>`);

    expect(raw).toContain('style:--fill="__tmvc_ba0__"');
    expect(raw).not.toContain('<!--');
  });

  it('keeps a later hole in the same tag classified correctly', () => {
    const raw = buildRawHtml(
      tsa`<div class:is-active="${true}" style:--x="${1}">${'text'}</div>`,
    );

    expect(raw).toContain('class:is-active="__tmvc_ba0__"');
    expect(raw).toContain('style:--x="__tmvc_ba1__"');
    expect(raw).toContain('<!--__tmvc_b2__-->');
  });

  it('classifies a multi part style: value as attribute holes', () => {
    const raw = buildRawHtml(tsa`<div style:--fill="${40}%"></div>`);

    expect(raw).toContain('style:--fill="__tmvc_ba0__%"');
  });
});
