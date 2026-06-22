// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textContent(frag: Fragment): string {
  return frag.nodes.map((n) => (n as Element).textContent).join('');
}

function outerHtml(frag: Fragment): string {
  return frag.nodes
    .map((n) => {
      if (n instanceof Element) return n.outerHTML;
      if (n.nodeType === Node.TEXT_NODE) return (n as Text).data;
      return '';
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Fragment class
// ---------------------------------------------------------------------------

describe('Fragment', () => {
  it('is exported from renderer/fragment.ts', () => {
    expect(Fragment).toBeDefined();
  });

  it('stores nodes passed to the constructor', () => {
    const div = document.createElement('div');
    const span = document.createElement('span');
    const frag = new Fragment([div, span]);
    expect(frag.nodes).toHaveLength(2);
    expect(frag.nodes[0]).toBe(div);
    expect(frag.nodes[1]).toBe(span);
  });

  it('dispose() calls all registered disposers', () => {
    const frag = new Fragment([]);
    let called = 0;
    frag.addDispose(() => { called++; });
    frag.addDispose(() => { called++; });
    frag.dispose();
    expect(called).toBe(2);
  });

  it('dispose() is idempotent', () => {
    const frag = new Fragment([]);
    let called = 0;
    frag.addDispose(() => { called++; });
    frag.dispose();
    frag.dispose();
    expect(called).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// html tagged template -- exported from renderer/html.ts
// ---------------------------------------------------------------------------

describe('html tagged template', () => {
  it('is exported from renderer/html.ts', () => {
    expect(html).toBeDefined();
    expect(typeof html).toBe('function');
  });

  it('returns a Fragment instance', () => {
    const frag = html`<p>Hello</p>`;
    expect(frag).toBeInstanceOf(Fragment);
  });

  // -------------------------------------------------------------------------
  // Static templates (no bindings)
  // -------------------------------------------------------------------------

  it('renders a static template with no bindings', () => {
    const frag = html`<div class="box"><span>text</span></div>`;
    expect(outerHtml(frag)).toBe('<div class="box"><span>text</span></div>');
  });

  it('returns distinct node trees on each call for static templates', () => {
    const a = html`<p>same</p>`;
    const b = html`<p>same</p>`;
    expect(a.nodes[0]).not.toBe(b.nodes[0]);
  });

  // -------------------------------------------------------------------------
  // Parse-once, clone-many (AC: parsed exactly once per call site)
  // -------------------------------------------------------------------------

  describe('parse-once, clone-many', () => {
    it('parses the template exactly once across multiple renders', () => {
      const spy = vi.spyOn(document, 'createElement');

      const render = (msg: string) => html`<p>${msg}</p>`;
      render('first');
      render('second');
      render('third');

      const templateCreations = spy.mock.calls.filter(
        (args) => args[0] === 'template',
      ).length;

      spy.mockRestore();
      expect(templateCreations).toBe(1);
    });

    it('each render call produces a distinct clone -- not shared nodes', () => {
      const render = (v: string) => html`<span>${v}</span>`;
      const a = render('a');
      const b = render('b');
      const c = render('c');

      expect(a.nodes[0]).not.toBe(b.nodes[0]);
      expect(b.nodes[0]).not.toBe(c.nodes[0]);
      expect(textContent(a)).toBe('a');
      expect(textContent(b)).toBe('b');
      expect(textContent(c)).toBe('c');
    });
  });

  // -------------------------------------------------------------------------
  // Sentinel markers survive parse-and-clone round trip
  // -------------------------------------------------------------------------

  it('sentinel comment is not present in the rendered output', () => {
    const frag = html`<p>${'hello'}</p>`;
    const p = frag.nodes[0] as Element;
    const commentNodes = Array.from(p.childNodes).filter(
      (n) => n.nodeType === Node.COMMENT_NODE,
    );
    expect(commentNodes).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Primitive value bindings
  // -------------------------------------------------------------------------

  it('renders a string value in text position', () => {
    const frag = html`<p>${'world'}</p>`;
    expect(textContent(frag)).toBe('world');
  });

  it('renders a number value in text position', () => {
    const frag = html`<p>${42}</p>`;
    expect(textContent(frag)).toBe('42');
  });

  it('renders multiple bindings in the correct positions', () => {
    const frag = html`<p>${'a'}${'b'}${'c'}</p>`;
    expect(textContent(frag)).toBe('abc');
  });

  it('renders null as empty', () => {
    const frag = html`<p>${null}</p>`;
    expect(textContent(frag)).toBe('');
  });

  it('renders undefined as empty', () => {
    const frag = html`<p>${undefined}</p>`;
    expect(textContent(frag)).toBe('');
  });

  it('renders false as empty', () => {
    const frag = html`<p>${false}</p>`;
    expect(textContent(frag)).toBe('');
  });

  // -------------------------------------------------------------------------
  // Nested html calls (AC: nested html calls work correctly)
  // -------------------------------------------------------------------------

  describe('nested html calls', () => {
    it('inserts a nested Fragment into the parent template', () => {
      const inner = html`<li>item</li>`;
      const outer = html`<ul>${inner}</ul>`;
      expect(outerHtml(outer)).toBe('<ul><li>item</li></ul>');
    });

    it('supports multi-level nesting', () => {
      const leaf = html`<span>leaf</span>`;
      const mid = html`<div>${leaf}</div>`;
      const root = html`<section>${mid}</section>`;
      expect(outerHtml(root)).toBe('<section><div><span>leaf</span></div></section>');
    });

    it('each call produces an independent Fragment even at the same call site', () => {
      const inner = (t: string) => html`<li>${t}</li>`;
      const a = inner('A');
      const b = inner('B');
      const outer = html`<ul>${a}${b}</ul>`;
      expect(outerHtml(outer)).toBe('<ul><li>A</li><li>B</li></ul>');
    });
  });

  // -------------------------------------------------------------------------
  // Arrays of Fragments (AC: arrays of Fragments work correctly)
  // -------------------------------------------------------------------------

  describe('arrays of Fragments', () => {
    it('renders an array of Fragments in order', () => {
      const items = ['Alpha', 'Beta', 'Gamma'].map((t) => html`<li>${t}</li>`);
      const frag = html`<ul>${items}</ul>`;
      expect(outerHtml(frag)).toBe('<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>');
    });

    it('renders an empty array as nothing', () => {
      const empty: Fragment[] = [];
      const frag = html`<ul>${empty}</ul>`;
      const ul = frag.nodes[0] as Element;
      expect(ul.childNodes).toHaveLength(0);
    });

    it('arrays mixed with other bindings work', () => {
      const items = ['X', 'Y'].map((t) => html`<li>${t}</li>`);
      const frag = html`<div><ul>${items}</ul></div>`;
      expect(outerHtml(frag)).toBe('<div><ul><li>X</li><li>Y</li></ul></div>');
    });
  });

  // -------------------------------------------------------------------------
  // Integration: first render, second render reuse
  // -------------------------------------------------------------------------

  describe('integration', () => {
    it('first and second renders produce structurally identical but distinct nodes', () => {
      const render = (name: string) => html`<h1>Hello, ${name}!</h1>`;
      const first = render('Alice');
      const second = render('Bob');

      expect(first.nodes[0]).not.toBe(second.nodes[0]);
      expect(textContent(first)).toBe('Hello, Alice!');
      expect(textContent(second)).toBe('Hello, Bob!');
    });

    it('template with mixed static and dynamic content renders correctly', () => {
      const frag = html`<article><h2>${'Title'}</h2><p>${'Body'}</p></article>`;
      const article = frag.nodes[0] as Element;
      expect(article.querySelector('h2')?.textContent).toBe('Title');
      expect(article.querySelector('p')?.textContent).toBe('Body');
    });
  });
});

// ---------------------------------------------------------------------------
// Public barrel re-export (AC: html re-exported from public barrel)
// ---------------------------------------------------------------------------

describe('public barrel export', () => {
  it('html is re-exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.html).toBeDefined();
    expect(typeof barrel.html).toBe('function');
  });
});
