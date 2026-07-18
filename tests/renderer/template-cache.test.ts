// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { getOrParseTemplate } from '../../src/renderer/template.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// Captures one TemplateStringsArray so the same literal identity can be parsed in
// both contexts, the way a dynamically selected tag would drive it.
function tsa(strings: TemplateStringsArray): TemplateStringsArray {
  return strings;
}

describe('template cache parse context', () => {
  it('parses the same strings array in both contexts, not once for both', () => {
    const strings = tsa`<circle r="10" />`;

    const asHtml = getOrParseTemplate(strings, 'html');
    const asSvg = getOrParseTemplate(strings, 'svg');

    expect(asHtml.template.content.firstElementChild?.namespaceURI).toBe(XHTML_NS);
    expect(asSvg.template.content.firstElementChild?.namespaceURI).toBe(SVG_NS);
  });

  it('reuses the cached parse within a single context', () => {
    const strings = tsa`<div></div>`;
    expect(getOrParseTemplate(strings, 'html')).toBe(getOrParseTemplate(strings, 'html'));
  });
});
