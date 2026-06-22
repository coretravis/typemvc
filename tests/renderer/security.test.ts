// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, sanitizeUrl } from '../../src/renderer/escape.js';
import { SafeHtml, safeHtml } from '../../src/renderer/safe-html.js';
import { html } from '../../src/renderer/html.js';

// ---------------------------------------------------------------------------
// escapeHtml -- all five specified characters
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('encodes &', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('encodes <', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('encodes >', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('encodes "', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it("encodes '", () => {
    expect(escapeHtml("it's here")).toBe('it&#39;s here');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello, world')).toBe('Hello, world');
  });

  it('encodes all five special chars in a single pass', () => {
    expect(escapeHtml('<b class="x">a & b\'s</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;a &amp; b&#39;s&lt;/b&gt;',
    );
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves already-encoded entities as-is (no double encoding)', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

// ---------------------------------------------------------------------------
// escapeAttr -- same as escapeHtml plus backtick
// ---------------------------------------------------------------------------

describe('escapeAttr', () => {
  it('encodes & < > " \'', () => {
    expect(escapeAttr('<b class="x">a & b\'</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;a &amp; b&#39;&lt;/b&gt;',
    );
  });

  it('additionally encodes backtick', () => {
    expect(escapeAttr('foo`bar')).toBe('foo&#96;bar');
  });

  it('encodes backtick that escapeHtml leaves unchanged', () => {
    expect(escapeHtml('foo`bar')).toBe('foo`bar');
    expect(escapeAttr('foo`bar')).toBe('foo&#96;bar');
  });

  it('handles empty string', () => {
    expect(escapeAttr('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl -- blocked protocols
// ---------------------------------------------------------------------------

describe('sanitizeUrl: blocked protocols', () => {
  it('blocks javascript:', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
  });

  it('blocks javascript: case-insensitively', () => {
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('#');
    expect(sanitizeUrl('JavaScript:alert(1)')).toBe('#');
  });

  it('blocks javascript: with leading whitespace', () => {
    expect(sanitizeUrl('   javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('\tjavascript:alert(1)')).toBe('#');
  });

  it('blocks vbscript:', () => {
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('blocks vbscript: case-insensitively', () => {
    expect(sanitizeUrl('VBSCRIPT:msgbox(1)')).toBe('#');
  });

  it('blocks data:', () => {
    expect(sanitizeUrl('data:text/html,<h1>XSS</h1>')).toBe('#');
  });

  it('blocks data: with base64 payload', () => {
    expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe('#');
  });

  it('blocks any unknown protocol', () => {
    expect(sanitizeUrl('ftp://evil.example.com')).toBe('#');
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl -- allowed protocols and paths
// ---------------------------------------------------------------------------

describe('sanitizeUrl: allowed protocols and paths', () => {
  it('passes http:', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('passes https:', () => {
    expect(sanitizeUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('passes mailto:', () => {
    expect(sanitizeUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
  });

  it('passes tel:', () => {
    expect(sanitizeUrl('tel:+1-555-555-5555')).toBe('tel:+1-555-555-5555');
  });

  it('passes relative path starting with /', () => {
    expect(sanitizeUrl('/about')).toBe('/about');
    expect(sanitizeUrl('/path/to/page')).toBe('/path/to/page');
  });

  it('passes relative path starting with ./', () => {
    expect(sanitizeUrl('./images/photo.jpg')).toBe('./images/photo.jpg');
  });

  it('passes relative path starting with ../', () => {
    expect(sanitizeUrl('../parent/file')).toBe('../parent/file');
  });

  it('passes fragment-only URLs', () => {
    expect(sanitizeUrl('#section')).toBe('#section');
  });

  it('passes query-string-only URLs', () => {
    expect(sanitizeUrl('?search=hello')).toBe('?search=hello');
  });

  it('passes empty string', () => {
    expect(sanitizeUrl('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// SafeHtml -- bypass is explicit and deliberate
// ---------------------------------------------------------------------------

describe('SafeHtml', () => {
  it('SafeHtml class exists and requires explicit construction', () => {
    const sh = new SafeHtml('<b>bold</b>');
    expect(sh).toBeInstanceOf(SafeHtml);
    expect(sh.value).toBe('<b>bold</b>');
  });

  it('safeHtml() factory returns a SafeHtml instance', () => {
    const sh = safeHtml('<i>italic</i>');
    expect(sh).toBeInstanceOf(SafeHtml);
  });

  it('a plain string is NOT treated as SafeHtml', () => {
    const plain = '<b>bold</b>';
    const frag = html`<div>${plain}</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.querySelector('b')).toBeNull();
    expect(div.textContent).toBe('<b>bold</b>');
  });

  it('SafeHtml inserted via innerHTML creates DOM elements', () => {
    const frag = html`<div>${safeHtml('<em>em</em><strong>strong</strong>')}</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.querySelector('em')?.textContent).toBe('em');
    expect(div.querySelector('strong')?.textContent).toBe('strong');
  });

  it('SafeHtml is re-exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.SafeHtml).toBeDefined();
    expect(barrel.safeHtml).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// XSS protection -- text bindings
// ---------------------------------------------------------------------------

describe('XSS protection: text bindings', () => {
  it('<script> in text position is not executed as HTML', () => {
    const frag = html`<div>${'<script>window.__xss=1</script>'}</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.querySelector('script')).toBeNull();
    expect(div.textContent).toBe('<script>window.__xss=1</script>');
  });

  it('innerHTML of text binding shows entity-escaped form', () => {
    const frag = html`<span>${'<b>bold</b>'}</span>`;
    const span = frag.nodes[0] as Element;
    expect(span.innerHTML).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('& in text position is not decoded as HTML entity', () => {
    const frag = html`<p>${'Tom & Jerry'}</p>`;
    const p = frag.nodes[0] as Element;
    expect(p.textContent).toBe('Tom & Jerry');
  });

  it('< and > in text position are not interpreted as tags', () => {
    const frag = html`<p>${'2 < 3 and 5 > 4'}</p>`;
    const p = frag.nodes[0] as Element;
    expect(p.textContent).toBe('2 < 3 and 5 > 4');
    expect(p.children.length).toBe(0);
  });

  it('" in text position does not break surrounding attribute', () => {
    const frag = html`<p>${'"quoted"'}</p>`;
    expect((frag.nodes[0] as Element).textContent).toBe('"quoted"');
  });

  it("' in text position is rendered as literal apostrophe", () => {
    const frag = html`<p>${"it's fine"}</p>`;
    expect((frag.nodes[0] as Element).textContent).toBe("it's fine");
  });

  it('complete XSS attempt in text position does not produce any child elements', () => {
    const xss =
      '<img src=x onerror="alert(1)"><iframe src="javascript:alert(1)"></iframe>';
    const frag = html`<div>${xss}</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('iframe')).toBeNull();
    expect(div.textContent).toBe(xss);
  });
});

// ---------------------------------------------------------------------------
// XSS protection -- attribute bindings
// ---------------------------------------------------------------------------

describe('XSS protection: attribute bindings', () => {
  it('attribute injection attempt does not create additional attributes', () => {
    const injection = '" data-evil="yes';
    const frag = html`<div class="${injection}">text</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.getAttribute('data-evil')).toBeNull();
    expect(div.getAttribute('class')).toBe(injection);
  });

  it('closing-tag injection in attribute does not break structure', () => {
    const injection = '"></div><script>alert(1)</script>';
    const frag = html`<span title="${injection}">text</span>`;
    const span = frag.nodes[0] as Element;
    expect(span.querySelector('script')).toBeNull();
    expect(span.getAttribute('title')).toBe(injection);
  });
});

// ---------------------------------------------------------------------------
// URL sanitization -- automatic for href, src, action, data-*-url
// ---------------------------------------------------------------------------

describe('URL sanitization: automatic application', () => {
  it('href binding: javascript: blocked', () => {
    const frag = html`<a href="${'javascript:alert(1)'}">link</a>`;
    expect((frag.nodes[0] as Element).getAttribute('href')).toBe('#');
  });

  it('href binding: https: allowed', () => {
    const frag = html`<a href="${'https://example.com'}">link</a>`;
    expect((frag.nodes[0] as Element).getAttribute('href')).toBe('https://example.com');
  });

  it('href binding: relative path allowed', () => {
    const frag = html`<a href="${'/about'}">link</a>`;
    expect((frag.nodes[0] as Element).getAttribute('href')).toBe('/about');
  });

  it('src binding: javascript: blocked', () => {
    const frag = html`<img src="${'javascript:alert(1)'}">`;
    expect((frag.nodes[0] as Element).getAttribute('src')).toBe('#');
  });

  it('src binding: https: allowed', () => {
    const frag = html`<img src="${'https://example.com/img.png'}">`;
    expect((frag.nodes[0] as Element).getAttribute('src')).toBe(
      'https://example.com/img.png',
    );
  });

  it('src binding: data: blocked', () => {
    const payload = 'data:text/html,<script>alert(1)</script>';
    const frag = html`<img src="${payload}">`;
    expect((frag.nodes[0] as Element).getAttribute('src')).toBe('#');
  });

  it('action binding: javascript: blocked', () => {
    const frag = html`<form action="${'javascript:alert(1)'}"></form>`;
    expect((frag.nodes[0] as Element).getAttribute('action')).toBe('#');
  });

  it('action binding: relative path allowed', () => {
    const frag = html`<form action="${'/submit'}"></form>`;
    expect((frag.nodes[0] as Element).getAttribute('action')).toBe('/submit');
  });

  it('data-*-url binding: javascript: blocked', () => {
    const frag = html`<div data-redirect-url="${'javascript:alert(1)'}">x</div>`;
    expect((frag.nodes[0] as Element).getAttribute('data-redirect-url')).toBe('#');
  });

  it('data-*-url binding: https: allowed', () => {
    const frag = html`<div data-redirect-url="${'https://example.com'}">x</div>`;
    expect((frag.nodes[0] as Element).getAttribute('data-redirect-url')).toBe(
      'https://example.com',
    );
  });

  it('data-*-url binding: vbscript: blocked', () => {
    const frag = html`<div data-link-url="${'vbscript:msgbox(1)'}">x</div>`;
    expect((frag.nodes[0] as Element).getAttribute('data-link-url')).toBe('#');
  });

  it('data-*-url binding: data: blocked', () => {
    const frag = html`<div data-image-url="${'data:text/html,bad'}">x</div>`;
    expect((frag.nodes[0] as Element).getAttribute('data-image-url')).toBe('#');
  });

  it('non-URL attribute is not sanitized', () => {
    const frag = html`<div title="${'javascript:foo'}">text</div>`;
    expect((frag.nodes[0] as Element).getAttribute('title')).toBe('javascript:foo');
  });
});

// ---------------------------------------------------------------------------
// Event handler integrity -- strings never eval'd
// ---------------------------------------------------------------------------

describe('Event handler integrity', () => {
  it('string in on* position throws a descriptive error', () => {
    const render = () => html`<button onclick="${'alert(1)'}">go</button>`;
    expect(render).toThrow('[TypeMVC]');
  });

  it('number in on* position throws a descriptive error', () => {
    const render = () => html`<button onclick="${42}">go</button>`;
    expect(render).toThrow('[TypeMVC]');
  });

  it('function in on* position does not throw', () => {
    let ok = false;
    const render = () => html`<button onclick=${() => { ok = true; }}>go</button>`;
    expect(render).not.toThrow();
    expect(ok).toBe(false);
  });

  it('onclick attribute is absent from final DOM', () => {
    const frag = html`<button onclick=${() => undefined}>go</button>`;
    const button = frag.nodes[0] as Element;
    expect(button.hasAttribute('onclick')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prototype pollution protection
// ---------------------------------------------------------------------------

describe('Prototype pollution protection', () => {
  it('escapeHtml handles __proto__ key lookup without prototype pollution', () => {
    expect(escapeHtml('__proto__')).toBe('__proto__');
  });

  it('escapeAttr handles constructor key lookup without prototype pollution', () => {
    expect(escapeAttr('constructor')).toBe('constructor');
  });

  it('escapeHtml does not inherit from Object.prototype', () => {
    expect(escapeHtml('toString')).toBe('toString');
  });
});
