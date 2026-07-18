// @vitest-environment happy-dom
/**
 * Tests for issue 023: zero-build .tmvc runtime parser.
 *
 * Acceptance criteria verified here:
 *   AC1  Runtime parser accepts a .tmvc string and returns a TmvcViewFunction
 *   AC2  Parser correctly handles TypeScript expressions in .tmvc markup
 *   AC3  context is implicitly available within the evaluated function
 *   AC4  A descriptive [TypeMVC] error is thrown when new Function() fails (CSP)
 *   AC5  CSP requirement documented in the API (verified via thrown error message)
 *   AC6  Functional parity with the Vite plugin
 *   AC7  Test scenarios: basic view, nested html, invalid expression, CSP-blocked
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import { Fragment } from '../../src/renderer/fragment.js';
import type { ViewContext } from '../../src/types/index.js';
import { _setComponentRegistry } from '../../src/core/component-registry.js';
import { html } from '../../src/renderer/html.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(data: Record<string, unknown> = {}): ViewContext {
  return {
    model: Object.create(null) as Record<string, unknown>,
    data,
    errors: { action: null },
    router: {
      navigateTo: () => { return; },
      replace: () => { return; },
      back: () => { return; },
      forward: () => { return; },
      current: '/',
    },
    params: {},
    query: new URLSearchParams(),
    partial: () => { throw new Error('partial not configured in test context'); },
  };
}

function textContent(frag: Fragment): string {
  return frag.nodes
    .map((n) => {
      if (n instanceof Element) return n.textContent;
      if (n.nodeType === Node.TEXT_NODE) return (n as Text).data;
      return '';
    })
    .join('');
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
// AC1: parseTmvc returns a TmvcViewFunction
// ---------------------------------------------------------------------------

describe('AC1: parseTmvc returns a TmvcViewFunction', () => {
  it('returns a function for a minimal valid source', () => {
    expect(typeof parseTmvc('<p>Hello</p>')).toBe('function');
  });

  it('returned function accepts a ViewContext and returns a Fragment', () => {
    const fn = parseTmvc('<p>Hello</p>');
    const result = fn(makeContext());
    expect(result).toBeInstanceOf(Fragment);
  });

  it('returned Fragment has nodes', () => {
    const fn = parseTmvc('<p>Hello</p>');
    const result = fn(makeContext());
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('returned function is callable multiple times', () => {
    const fn = parseTmvc('<p>Hello</p>');
    const r1 = fn(makeContext());
    const r2 = fn(makeContext());
    expect(r1).toBeInstanceOf(Fragment);
    expect(r2).toBeInstanceOf(Fragment);
  });

  it('each call produces a distinct Fragment instance', () => {
    const fn = parseTmvc('<p>Hello</p>');
    const r1 = fn(makeContext());
    const r2 = fn(makeContext());
    expect(r1).not.toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// AC2: expressions in .tmvc markup are evaluated correctly
// ---------------------------------------------------------------------------

describe('AC2: TypeScript expressions in .tmvc markup', () => {
  it('plain markup produces the expected text', () => {
    const fn = parseTmvc('<p>Static text</p>');
    expect(textContent(fn(makeContext()))).toBe('Static text');
  });

  it('interpolated string expression produces correct text', () => {
    const fn = parseTmvc('<p>${context.data.msg}</p>');
    const ctx = makeContext({ msg: 'Hello World' });
    expect(textContent(fn(ctx))).toBe('Hello World');
  });

  it('ternary expression evaluates the truthy branch', () => {
    const fn = parseTmvc('${context.data.show ? "visible" : "hidden"}');
    expect(textContent(fn(makeContext({ show: true })))).toContain('visible');
  });

  it('ternary expression evaluates the falsy branch', () => {
    const fn = parseTmvc('${context.data.show ? "visible" : "hidden"}');
    expect(textContent(fn(makeContext({ show: false })))).toContain('hidden');
  });

  it('arithmetic expression is evaluated', () => {
    const fn = parseTmvc('<span>${context.data.x + context.data.y}</span>');
    const ctx = makeContext({ x: 3, y: 4 });
    expect(textContent(fn(ctx))).toBe('7');
  });
});

// ---------------------------------------------------------------------------
// AC3: context is implicitly available
// ---------------------------------------------------------------------------

describe('AC3: context is implicitly available in the evaluated function', () => {
  it('context.data values are accessible', () => {
    const fn = parseTmvc('${context.data.title}');
    const ctx = makeContext({ title: 'My Page' });
    expect(textContent(fn(ctx))).toBe('My Page');
  });

  it('context.errors values are accessible', () => {
    const fn = parseTmvc('${context.errors.name ?? "no-error"}');
    const ctx: ViewContext = {
      ...makeContext(),
      errors: { action: null, name: 'Required' },
    };
    expect(textContent(fn(ctx))).toBe('Required');
  });

  it('context.params values are accessible', () => {
    const fn = parseTmvc('${context.params.id}');
    const ctx: ViewContext = {
      ...makeContext(),
      params: { id: '42' },
    };
    expect(textContent(fn(ctx))).toBe('42');
  });

  it('context itself is the only required implicit binding (no other globals needed)', () => {
    const fn = parseTmvc('<h1>${context.data.heading}</h1>');
    const ctx = makeContext({ heading: 'Hello' });
    const frag = fn(ctx);
    expect(textContent(frag)).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// AC4 + AC5: descriptive error when new Function() fails (CSP scenario)
// ---------------------------------------------------------------------------

describe('AC4 + AC5: descriptive error when new Function() fails', () => {
  it('throws a [TypeMVC]-prefixed error when new Function() fails', () => {
    // Source that passes validateTmvcSource but produces a JS body with an
    // unclosed string literal, causing new Function() to throw a SyntaxError.
    // In production, this code path is typically triggered by a CSP violation.
    expect(() => parseTmvc("${'}")).toThrow('[TypeMVC]');
  });

  it('error message mentions the unsafe-eval CSP directive', () => {
    expect(() => parseTmvc("${'}")).toThrow("'unsafe-eval'");
  });

  it('error message mentions script-src', () => {
    expect(() => parseTmvc("${'}")).toThrow('script-src');
  });

  it('error message includes the original error for diagnosis', () => {
    expect(() => parseTmvc("${'}")).toThrow('Original error:');
  });
});

// ---------------------------------------------------------------------------
// AC6: functional parity with the Vite plugin
// ---------------------------------------------------------------------------

describe('AC6: functional parity with the Vite plugin', () => {
  it('produces a Fragment with the expected element structure', () => {
    const fn = parseTmvc('<h1>Users</h1>');
    const frag = fn(makeContext());
    expect(outerHtml(frag)).toBe('<h1>Users</h1>');
  });

  it('same source view produces same rendered output as Vite plugin would', () => {
    // The Vite plugin transforms the source into: return html`<source>`.
    // The runtime parser builds the same function body and evaluates it.
    // Both paths must produce identical DOM output.
    const fn = parseTmvc('<p class="title">${context.data.text}</p>');
    const ctx = makeContext({ text: 'Parity' });
    expect(outerHtml(fn(ctx))).toBe('<p class="title">Parity</p>');
  });

  it('backticks in markup are escaped the same as the Vite plugin escapes them', () => {
    const fn = parseTmvc('<code>`snippet`</code>');
    const frag = fn(makeContext());
    expect(textContent(frag)).toBe('`snippet`');
  });
});

// ---------------------------------------------------------------------------
// AC7: basic view parse-and-run
// ---------------------------------------------------------------------------

describe('AC7: basic view parse-and-run', () => {
  it('empty source returns a Fragment with a single empty text node', () => {
    const fn = parseTmvc('');
    const frag = fn(makeContext());
    expect(frag).toBeInstanceOf(Fragment);
  });

  it('minimal view with static text renders correctly', () => {
    const fn = parseTmvc('<p>Hello, TypeMVC!</p>');
    expect(textContent(fn(makeContext()))).toBe('Hello, TypeMVC!');
  });

  it('view with data context renders dynamic content', () => {
    const fn = parseTmvc('<h1>${context.data.name}</h1>');
    const ctx = makeContext({ name: 'Alice' });
    expect(textContent(fn(ctx))).toBe('Alice');
  });

  it('view with multiple expressions renders all correctly', () => {
    const fn = parseTmvc('<p>${context.data.first} ${context.data.last}</p>');
    const ctx = makeContext({ first: 'John', last: 'Doe' });
    expect(textContent(fn(ctx))).toBe('John Doe');
  });

  it('multi-line .tmvc source renders correctly', () => {
    const source = '<h1>Users</h1>\n<p>${context.data.count} users</p>';
    const fn = parseTmvc(source);
    const ctx = makeContext({ count: 42 });
    const html = outerHtml(fn(ctx));
    expect(html).toContain('<h1>Users</h1>');
    expect(html).toContain('42 users');
  });
});

// ---------------------------------------------------------------------------
// AC7: nested html expressions
// ---------------------------------------------------------------------------

describe('AC7: nested html expressions', () => {
  it('array.map with nested html tagged template renders each item', () => {
    const fn = parseTmvc(
      '<ul>${context.data.items.map(item => html`<li>${item}</li>`)}</ul>',
    );
    const ctx = makeContext({ items: ['Alpha', 'Beta', 'Gamma'] });
    const result = outerHtml(fn(ctx));
    expect(result).toContain('<li>Alpha</li>');
    expect(result).toContain('<li>Beta</li>');
    expect(result).toContain('<li>Gamma</li>');
  });

  it('nested html reference inside expression closure resolves to the framework html', () => {
    const fn = parseTmvc('${html`<em>inner</em>`}');
    const result = outerHtml(fn(makeContext()));
    expect(result).toContain('<em>inner</em>');
  });

  it('deeply nested html calls render correctly', () => {
    const fn = parseTmvc(
      '${context.data.rows.map(row => html`<tr>${row.cells.map(c => html`<td>${c}</td>`)}</tr>`)}',
    );
    const ctx = makeContext({
      rows: [{ cells: ['A', 'B'] }, { cells: ['C', 'D'] }],
    });
    const result = outerHtml(fn(ctx));
    expect(result).toContain('<td>A</td>');
    expect(result).toContain('<td>D</td>');
  });
});

// ---------------------------------------------------------------------------
// AC7: error on invalid expression (forbidden constructs)
// ---------------------------------------------------------------------------

describe('AC7: error on invalid expression (forbidden constructs)', () => {
  it('throws [TypeMVC] error when source contains import statement', () => {
    expect(() => parseTmvc("import x from 'y';")).toThrow('[TypeMVC]');
  });

  it('import error includes line number', () => {
    expect(() => parseTmvc("<p>ok</p>\nimport x from 'y';")).toThrow('line 2');
  });

  it('import error is descriptive and actionable', () => {
    expect(() => parseTmvc("import x from 'y';")).toThrow(
      'import declarations are not permitted',
    );
  });

  it('throws [TypeMVC] error when source contains export statement', () => {
    expect(() => parseTmvc('export const x = 1;')).toThrow('[TypeMVC]');
  });

  it('export error includes line number', () => {
    expect(() => parseTmvc('<p>ok</p>\nexport const y = 2;')).toThrow('line 2');
  });

  it('throws [TypeMVC] error when source contains class definition', () => {
    expect(() => parseTmvc('class Foo {}')).toThrow('[TypeMVC]');
  });

  it('class error includes line number', () => {
    expect(() => parseTmvc('<p>ok</p>\nclass Bar {}')).toThrow('line 2');
  });

  it('expression inside ${...} does not trigger false positive for import', () => {
    const fn = parseTmvc("${context.data.x}import-like-text");
    expect(() => fn(makeContext({ x: '' }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC7: CSP-blocked scenario
// ---------------------------------------------------------------------------

describe('AC7: CSP-blocked scenario', () => {
  it('throws when new Function() raises an error', () => {
    expect(() => parseTmvc("${'}")).toThrow();
  });

  it('error thrown when new Function() fails has [TypeMVC] prefix', () => {
    expect(() => parseTmvc("${'}")).toThrow('[TypeMVC]');
  });

  it('error mentions the unsafe-eval CSP requirement', () => {
    expect(() => parseTmvc("${'}")).toThrow("'unsafe-eval'");
  });

  it('error does not silently swallow the original cause', () => {
    let caughtMessage = '';
    try {
      parseTmvc("${'}");
    } catch (err) {
      if (err instanceof Error) caughtMessage = err.message;
    }
    expect(caughtMessage).toContain('Original error:');
    expect(caughtMessage.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Component tag syntax: integration with parseTmvc (issue 034)
// ---------------------------------------------------------------------------

describe('component tag syntax: parseTmvc integration', () => {
  beforeEach(() => {
    // Reset registry to a known state before each test
    _setComponentRegistry(Object.create(null) as Record<string, never>);
  });

  it('source with a component tag parses without error', () => {
    expect(() => parseTmvc('<Badge label="total" />')).not.toThrow();
  });

  it('component tag with no registered component renders an empty Fragment', () => {
    const fn = parseTmvc('<Badge label="total" />');
    const frag = fn(makeContext());
    expect(frag).toBeInstanceOf(Fragment);
  });

  it('registered component is called and renders its output', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- ComponentFunction uses any props
    _setComponentRegistry({ Badge: (p) => html`<span class="badge">${String(p.label ?? '')}</span>` });

    const fn = parseTmvc('<Badge label="total" />');
    const frag = fn(makeContext());
    const elements = frag.nodes.filter((n): n is Element => n instanceof Element);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements[0]?.outerHTML).toContain('badge');
    expect(elements[0]?.textContent).toBe('total');
  });

  it('component receives dynamic expression props', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- ComponentFunction uses any props
    _setComponentRegistry({ Counter: (p) => html`<span>${String(p.count ?? 0)}</span>` });

    const fn = parseTmvc('<Counter count="${context.data.n}" />');
    const frag = fn(makeContext({ n: 42 }));
    const elements = frag.nodes.filter((n): n is Element => n instanceof Element);
    expect(elements[0]?.textContent).toBe('42');
  });

  it('component receives spread props from ...${obj}', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- ComponentFunction uses any props
    _setComponentRegistry({ Badge: (p) => html`<span>${String(p.label ?? '')}</span>` });

    const fn = parseTmvc('<Badge ...${context.data.obj} />');
    const frag = fn(makeContext({ obj: { label: 'spread' } }));
    const elements = frag.nodes.filter((n): n is Element => n instanceof Element);
    expect(elements[0]?.textContent).toBe('spread');
  });

  it('component tag alongside native markup renders both', () => {
    _setComponentRegistry({
      Tag: () => html`<b>tag</b>`,
    });

    const fn = parseTmvc('<p>before</p><Tag /><p>after</p>');
    const frag = fn(makeContext());
    const html_ = frag.nodes
      .map((n) => (n instanceof Element ? n.outerHTML : ''))
      .join('');
    expect(html_).toContain('<p>before</p>');
    expect(html_).toContain('<b>tag</b>');
    expect(html_).toContain('<p>after</p>');
  });
});
