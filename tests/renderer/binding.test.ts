// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { signal, computed } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import type { MountCallback } from '../../src/renderer/fragment.js';
import { SafeHtml, safeHtml } from '../../src/renderer/safe-html.js';
import { keyed } from '../../src/renderer/keyed.js';
import { renderValue, isReadonlySignal } from '../../src/renderer/binding.js';
import type { BindingContext, DisposeCollector } from '../../src/renderer/binding.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCollector(): DisposeCollector & { disposes: (() => void)[]; mounts: MountCallback[] } {
  const disposes: (() => void)[] = [];
  const mounts: MountCallback[] = [];
  return {
    disposes,
    mounts,
    addDispose(fn: () => void): void {
      disposes.push(fn);
    },
    addMount(fn: MountCallback): void {
      mounts.push(fn);
    },
  };
}

/** Puts a fragment's nodes in the document and mounts it, as the outlet does. */
function mount(frag: Fragment): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  for (const node of frag.nodes) host.appendChild(node);
  frag.mount();
  return host;
}

function makeNodeCtx(container: Element): { ctx: BindingContext; comment: Comment } {
  const comment = document.createComment('test');
  container.appendChild(comment);
  const ctx: BindingContext = { kind: 'node', comment };
  return { ctx, comment };
}

function makeAttrCtx(element: Element, attrName: string): BindingContext {
  return { kind: 'attr', element, attrName };
}

function makeEventCtx(element: Element, attrName: string): BindingContext {
  return { kind: 'event', element, attrName, eventName: attrName.slice(2) };
}

// ---------------------------------------------------------------------------
// isReadonlySignal type guard
// ---------------------------------------------------------------------------

describe('isReadonlySignal', () => {
  it('returns true for a signal', () => {
    const s = signal('hello');
    expect(isReadonlySignal(s)).toBe(true);
  });

  it('returns true for a computed signal', () => {
    const s = signal(1);
    const c = { get: () => s.get() * 2 };
    expect(isReadonlySignal(c)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isReadonlySignal(null)).toBe(false);
  });

  it('returns false for a plain object without get', () => {
    expect(isReadonlySignal({ set: () => undefined })).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isReadonlySignal('hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderValue -- node position
// ---------------------------------------------------------------------------

describe('renderValue: node position', () => {
  it('inserts a text node for a string value and removes the comment', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue('hello', ctx, makeCollector());
    expect(container.textContent).toBe('hello');
    expect(container.childNodes.length).toBe(1);
    expect(container.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  it('inserts a text node for a number value', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue(42, ctx, makeCollector());
    expect(container.textContent).toBe('42');
  });

  it('inserts a text node for boolean true', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue(true, ctx, makeCollector());
    expect(container.textContent).toBe('true');
  });

  it('renders string without HTML-encoding (no double-encode via DOM API)', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue('Hello & <World>', ctx, makeCollector());
    expect(container.textContent).toBe('Hello & <World>');
  });

  it('removes comment and renders nothing for null', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue(null, ctx, makeCollector());
    expect(container.textContent).toBe('');
    expect(container.childNodes.length).toBe(0);
  });

  it('removes comment and renders nothing for undefined', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue(undefined, ctx, makeCollector());
    expect(container.childNodes.length).toBe(0);
  });

  it('removes comment and renders nothing for false', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue(false, ctx, makeCollector());
    expect(container.childNodes.length).toBe(0);
  });

  it('inserts Fragment nodes in order and removes comment', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    const span = document.createElement('span');
    span.textContent = 'inner';
    const frag = new Fragment([span]);
    renderValue(frag, ctx, makeCollector());
    expect(container.children.length).toBe(1);
    expect(container.querySelector('span')?.textContent).toBe('inner');
    expect(Array.from(container.childNodes).every((n) => n.nodeType !== Node.COMMENT_NODE)).toBe(true);
  });

  it('inserts SafeHtml markup verbatim (bypasses escaping)', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue(safeHtml('<b>bold</b>'), ctx, makeCollector());
    expect(container.querySelector('b')?.textContent).toBe('bold');
  });

  it('inserts an array of Fragments in order', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    const items = ['A', 'B', 'C'].map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return new Fragment([li]);
    });
    renderValue(items, ctx, makeCollector());
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0]?.textContent).toBe('A');
    expect(lis[1]?.textContent).toBe('B');
    expect(lis[2]?.textContent).toBe('C');
  });

  it('renders an empty array as nothing', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    renderValue([], ctx, makeCollector());
    expect(container.childNodes.length).toBe(0);
  });

  it('throws a descriptive error for a plain object in node position', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    expect(() => { renderValue({ foo: 'bar' }, ctx, makeCollector()); }).toThrow('[TypeMVC]');
  });

  it('throws for a function in non-event node position', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    expect(() => { renderValue(() => undefined, ctx, makeCollector()); }).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// renderValue -- node position with Signal
// ---------------------------------------------------------------------------

describe('renderValue: node position -- Signal', () => {
  it('creates a text node whose data updates when signal changes', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    const s = signal('initial');
    const collector = makeCollector();
    renderValue(s, ctx, collector);

    expect(container.textContent).toBe('initial');
    s.set('updated');
    flush();
    expect(container.textContent).toBe('updated');
  });

  it('stores a dispose function in the collector', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    const collector = makeCollector();
    renderValue(signal('x'), ctx, collector);
    expect(collector.disposes.length).toBe(1);
  });

  it('stops updating after dispose is called', () => {
    const container = document.createElement('div');
    const { ctx } = makeNodeCtx(container);
    const s = signal('before');
    const collector = makeCollector();
    renderValue(s, ctx, collector);

    collector.disposes[0]?.();
    s.set('after');
    flush();
    expect(container.textContent).toBe('before');
  });

  it('updates text in-place without re-rendering surrounding DOM', () => {
    const container = document.createElement('div');
    const before = document.createTextNode('prefix:');
    const after = document.createTextNode(':suffix');
    container.appendChild(before);
    const comment = document.createComment('test');
    container.appendChild(comment);
    container.appendChild(after);

    const ctx: BindingContext = { kind: 'node', comment };
    const s = signal('mid');
    renderValue(s, ctx, makeCollector());

    expect(container.textContent).toBe('prefix:mid:suffix');
    s.set('NEW');
    flush();
    expect(container.textContent).toBe('prefix:NEW:suffix');
    // prefix and suffix nodes are still the same objects
    expect(container.firstChild).toBe(before);
    expect(container.lastChild).toBe(after);
  });

  it('throws when Signal is placed in event context', () => {
    const button = document.createElement('button');
    const ctx: BindingContext = {
      kind: 'event',
      element: button,
      attrName: 'onclick',
      eventName: 'click',
    };
    expect(() => { renderValue(signal(() => undefined), ctx, makeCollector()); }).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// renderValue -- attribute position
// ---------------------------------------------------------------------------

describe('renderValue: attribute position', () => {
  it('sets a string value as attribute', () => {
    const div = document.createElement('div');
    div.setAttribute('class', '__tmvc_ba0__');
    renderValue('active', makeAttrCtx(div, 'class'), makeCollector());
    expect(div.getAttribute('class')).toBe('active');
  });

  it('sets a number value as attribute', () => {
    const div = document.createElement('div');
    renderValue(3, makeAttrCtx(div, 'tabindex'), makeCollector());
    expect(div.getAttribute('tabindex')).toBe('3');
  });

  it('removes attribute for null', () => {
    const div = document.createElement('div');
    div.setAttribute('title', 'old');
    renderValue(null, makeAttrCtx(div, 'title'), makeCollector());
    expect(div.hasAttribute('title')).toBe(false);
  });

  it('removes attribute for undefined', () => {
    const div = document.createElement('div');
    div.setAttribute('title', 'old');
    renderValue(undefined, makeAttrCtx(div, 'title'), makeCollector());
    expect(div.hasAttribute('title')).toBe(false);
  });

  it('removes attribute for false', () => {
    const div = document.createElement('div');
    div.setAttribute('title', 'old');
    renderValue(false, makeAttrCtx(div, 'title'), makeCollector());
    expect(div.hasAttribute('title')).toBe(false);
  });

  it('sets boolean attribute to empty string for true', () => {
    const input = document.createElement('input');
    renderValue(true, makeAttrCtx(input, 'disabled'), makeCollector());
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.getAttribute('disabled')).toBe('');
  });

  it('removes boolean attribute for false', () => {
    const input = document.createElement('input');
    input.setAttribute('disabled', '');
    renderValue(false, makeAttrCtx(input, 'disabled'), makeCollector());
    expect(input.hasAttribute('disabled')).toBe(false);
  });

  it('sanitizes href attribute', () => {
    const a = document.createElement('a');
    renderValue('javascript:alert(1)', makeAttrCtx(a, 'href'), makeCollector());
    expect(a.getAttribute('href')).toBe('#');
  });

  it('allows safe href values', () => {
    const a = document.createElement('a');
    renderValue('https://example.com', makeAttrCtx(a, 'href'), makeCollector());
    expect(a.getAttribute('href')).toBe('https://example.com');
  });

  it('sanitizes src attribute', () => {
    const img = document.createElement('img');
    renderValue('data:text/html,<script>alert(1)</script>', makeAttrCtx(img, 'src'), makeCollector());
    expect(img.getAttribute('src')).toBe('#');
  });
});

// ---------------------------------------------------------------------------
// renderValue -- attribute position with Signal
// ---------------------------------------------------------------------------

describe('renderValue: attribute position -- Signal', () => {
  it('applies signal value to attribute immediately', () => {
    const div = document.createElement('div');
    const s = signal('first');
    const collector = makeCollector();
    renderValue(s, makeAttrCtx(div, 'class'), collector);
    expect(div.getAttribute('class')).toBe('first');
  });

  it('updates attribute when signal changes', () => {
    const div = document.createElement('div');
    const s = signal('old');
    const collector = makeCollector();
    renderValue(s, makeAttrCtx(div, 'class'), collector);

    s.set('new');
    flush();
    expect(div.getAttribute('class')).toBe('new');
  });

  it('removes attribute when signal becomes null', () => {
    const div = document.createElement('div');
    const s = signal<string | null>('value');
    const collector = makeCollector();
    renderValue(s, makeAttrCtx(div, 'class'), collector);

    s.set(null);
    flush();
    expect(div.hasAttribute('class')).toBe(false);
  });

  it('stores a dispose function in the collector', () => {
    const div = document.createElement('div');
    const collector = makeCollector();
    renderValue(signal('x'), makeAttrCtx(div, 'data-val'), collector);
    expect(collector.disposes.length).toBe(1);
  });

  it('updates only the affected attribute, not surrounding DOM', () => {
    const div = document.createElement('div');
    div.setAttribute('id', 'myid');
    const s = signal('initial');
    renderValue(s, makeAttrCtx(div, 'class'), makeCollector());

    expect(div.getAttribute('id')).toBe('myid');
    s.set('changed');
    flush();
    expect(div.getAttribute('id')).toBe('myid');
    expect(div.getAttribute('class')).toBe('changed');
  });
});

// ---------------------------------------------------------------------------
// renderValue -- event position
// ---------------------------------------------------------------------------

describe('renderValue: event position', () => {
  it('attaches event listener to element', () => {
    const button = document.createElement('button');
    let clicked = false;
    renderValue(() => { clicked = true; }, makeEventCtx(button, 'onclick'), makeCollector());
    button.dispatchEvent(new Event('click'));
    expect(clicked).toBe(true);
  });

  it('removes the on* attribute from the DOM', () => {
    const button = document.createElement('button');
    button.setAttribute('onclick', '__tmvc_ba0__');
    renderValue(() => undefined, makeEventCtx(button, 'onclick'), makeCollector());
    expect(button.hasAttribute('onclick')).toBe(false);
  });

  it('removes old listener and attaches new one on re-bind', () => {
    const button = document.createElement('button');
    let calls1 = 0;
    let calls2 = 0;
    const handler1 = () => { calls1++; };
    const handler2 = () => { calls2++; };
    const ctx = makeEventCtx(button, 'onclick');

    renderValue(handler1, ctx, makeCollector());
    renderValue(handler2, ctx, makeCollector());

    button.dispatchEvent(new Event('click'));
    expect(calls1).toBe(0);
    expect(calls2).toBe(1);
  });

  it('throws for non-function value in event position', () => {
    const button = document.createElement('button');
    const ctx = makeEventCtx(button, 'onclick');
    expect(() => { renderValue('not-a-function', ctx, makeCollector()); }).toThrow('[TypeMVC]');
  });

  it('throws for number in event position', () => {
    const button = document.createElement('button');
    const ctx = makeEventCtx(button, 'onclick');
    expect(() => { renderValue(42, ctx, makeCollector()); }).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// html tagged template -- attribute bindings
// ---------------------------------------------------------------------------

describe('html: attribute bindings', () => {
  it('sets a static string attribute', () => {
    const frag = html`<div class="${'active'}">text</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.getAttribute('class')).toBe('active');
  });

  it('sets multiple attributes', () => {
    const frag = html`<a href="${'https://example.com'}" title="${'link'}">go</a>`;
    const a = frag.nodes[0] as Element;
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('title')).toBe('link');
  });

  it('handles boolean attribute disabled=true', () => {
    const frag = html`<input disabled=${true}>`;
    const input = frag.nodes[0] as Element;
    expect(input.hasAttribute('disabled')).toBe(true);
  });

  it('handles boolean attribute disabled=false', () => {
    const frag = html`<input disabled=${false}>`;
    const input = frag.nodes[0] as Element;
    expect(input.hasAttribute('disabled')).toBe(false);
  });

  it('sanitizes javascript: in href', () => {
    const frag = html`<a href="${'javascript:void(0)'}">click</a>`;
    const a = frag.nodes[0] as Element;
    expect(a.getAttribute('href')).toBe('#');
  });

  it('removes attribute for null value', () => {
    const frag = html`<div class="${null}">text</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.hasAttribute('class')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// html tagged template -- event bindings
// ---------------------------------------------------------------------------

describe('html: event bindings', () => {
  it('attaches click handler and removes onclick attribute', () => {
    let clicked = false;
    const frag = html`<button onclick=${() => { clicked = true; }}>Click</button>`;
    const button = frag.nodes[0] as HTMLButtonElement;
    expect(button.hasAttribute('onclick')).toBe(false);
    button.dispatchEvent(new Event('click'));
    expect(clicked).toBe(true);
  });

  it('attaches input handler for oninput', () => {
    let triggered = false;
    const frag = html`<input oninput=${() => { triggered = true; }}>`;
    const input = frag.nodes[0] as HTMLInputElement;
    expect(input.hasAttribute('oninput')).toBe(false);
    input.dispatchEvent(new Event('input'));
    expect(triggered).toBe(true);
  });

  it('passes the event object to the handler', () => {
    let received: Event | null = null;
    const frag = html`<button onclick=${(e: Event) => { received = e; }}>Go</button>`;
    const button = frag.nodes[0] as HTMLButtonElement;
    const ev = new Event('click');
    button.dispatchEvent(ev);
    expect(received).toBe(ev);
  });
});

// ---------------------------------------------------------------------------
// html tagged template -- Signal bindings
// ---------------------------------------------------------------------------

describe('html: Signal bindings', () => {
  it('renders initial signal value in text position', () => {
    const name = signal('Alice');
    const frag = html`<span>${name}</span>`;
    expect((frag.nodes[0] as Element).textContent).toBe('Alice');
  });

  it('updates text node when signal changes', () => {
    const name = signal('Alice');
    const frag = html`<p>${name}</p>`;
    const p = frag.nodes[0] as Element;

    name.set('Bob');
    flush();
    expect(p.textContent).toBe('Bob');
  });

  it('updates only the affected text node, not surrounding text', () => {
    const name = signal('World');
    const frag = html`<p>Hello, ${name}!</p>`;
    const p = frag.nodes[0] as Element;
    expect(p.textContent).toBe('Hello, World!');

    name.set('TypeMVC');
    flush();
    expect(p.textContent).toBe('Hello, TypeMVC!');
  });

  it('renders initial signal value in attribute position', () => {
    const cls = signal('inactive');
    const frag = html`<div class="${cls}">text</div>`;
    expect((frag.nodes[0] as Element).getAttribute('class')).toBe('inactive');
  });

  it('updates attribute when signal changes', () => {
    const cls = signal('old');
    const frag = html`<div class="${cls}">text</div>`;
    const div = frag.nodes[0] as Element;

    cls.set('new');
    flush();
    expect(div.getAttribute('class')).toBe('new');
  });

  it('Fragment.dispose() stops signal updates', () => {
    const s = signal('before');
    const frag = html`<span>${s}</span>`;
    const span = frag.nodes[0] as Element;

    frag.dispose();
    s.set('after');
    flush();
    expect(span.textContent).toBe('before');
  });
});

// ---------------------------------------------------------------------------
// SafeHtml -- bypasses escaping
// ---------------------------------------------------------------------------

describe('SafeHtml', () => {
  it('SafeHtml class is exported and constructable', () => {
    const sh = new SafeHtml('<b>bold</b>');
    expect(sh.value).toBe('<b>bold</b>');
  });

  it('safeHtml factory creates a SafeHtml instance', () => {
    const sh = safeHtml('<i>italic</i>');
    expect(sh).toBeInstanceOf(SafeHtml);
    expect(sh.value).toBe('<i>italic</i>');
  });

  it('SafeHtml in html template inserts raw HTML', () => {
    const frag = html`<div>${safeHtml('<b>bold</b>')}</div>`;
    const div = frag.nodes[0] as Element;
    expect(div.querySelector('b')?.textContent).toBe('bold');
  });

  it('SafeHtml is re-exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.safeHtml).toBeDefined();
    expect(typeof barrel.safeHtml).toBe('function');
    expect(barrel.SafeHtml).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl edge cases
// ---------------------------------------------------------------------------

describe('url sanitisation in attribute bindings', () => {
  it('allows relative paths', () => {
    const frag = html`<a href="${'/about'}">link</a>`;
    const a = frag.nodes[0] as Element;
    expect(a.getAttribute('href')).toBe('/about');
  });

  it('allows mailto:', () => {
    const frag = html`<a href="${'mailto:foo@example.com'}">email</a>`;
    const a = frag.nodes[0] as Element;
    expect(a.getAttribute('href')).toBe('mailto:foo@example.com');
  });

  it('blocks vbscript:', () => {
    const frag = html`<a href="${'vbscript:msgbox(1)'}">click</a>`;
    const a = frag.nodes[0] as Element;
    expect(a.getAttribute('href')).toBe('#');
  });
});

// ---------------------------------------------------------------------------
// Form control property bindings (issue 036 -- AC1-AC4)
// ---------------------------------------------------------------------------

describe('form control property binding: value', () => {
  it('sets .value property on <input> on initial render', () => {
    const frag = html`<input value="${'hello'}" />`;
    const input = frag.nodes[0] as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('updates .value property on <input> when signal changes after user interaction', () => {
    const s = signal('initial');
    const frag = html`<input value="${s}" />`;
    const input = frag.nodes[0] as HTMLInputElement;
    expect(input.value).toBe('initial');

    // Simulate user typing (disconnects attribute from property)
    input.value = 'user typed';
    expect(input.value).toBe('user typed');

    // Signal update must still drive .value
    s.set('signal update');
    flush();
    expect(input.value).toBe('signal update');
  });

  it('sets .value property on <textarea>', () => {
    const s = signal('content');
    const frag = html`<textarea value="${s}"></textarea>`;
    const textarea = frag.nodes[0] as HTMLTextAreaElement;
    expect(textarea.value).toBe('content');

    s.set('updated');
    flush();
    expect(textarea.value).toBe('updated');
  });

  it('sets .value property on <select>', () => {
    const s = signal('b');
    const frag = html`<select value="${s}"><option value="a">A</option><option value="b">B</option></select>`;
    const select = frag.nodes[0] as HTMLSelectElement;

    s.set('b');
    flush();
    expect(select.value).toBe('b');
  });

  it('does not throw for value on a non-form element (AC4)', () => {
    expect(() => {
      void html`<div value="${'ignored'}"></div>`;
    }).not.toThrow();
  });
});

describe('form control property binding: checked', () => {
  it('sets .checked property on <input type="checkbox"> for true', () => {
    const frag = html`<input type="checkbox" checked="${true}" />`;
    const input = frag.nodes[0] as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it('sets .checked property to false', () => {
    const frag = html`<input type="checkbox" checked="${false}" />`;
    const input = frag.nodes[0] as HTMLInputElement;
    expect(input.checked).toBe(false);
  });

  it('updates .checked property when signal changes after user interaction', () => {
    const s = signal(true);
    const frag = html`<input type="checkbox" checked="${s}" />`;
    const input = frag.nodes[0] as HTMLInputElement;
    expect(input.checked).toBe(true);

    // Simulate user unchecking (disconnects DOM property from attribute)
    input.checked = false;
    expect(input.checked).toBe(false);

    // Signal change drives .checked to false
    s.set(false);
    flush();
    expect(input.checked).toBe(false);

    // Signal change drives .checked back to true
    s.set(true);
    flush();
    expect(input.checked).toBe(true);
  });
});

describe('form control property binding: selected', () => {
  it('sets .selected property on <option> for true', () => {
    const frag = html`<select><option value="a" selected="${true}">A</option></select>`;
    const select = frag.nodes[0] as HTMLSelectElement;
    const option = select.options.item(0);
    if (option === null) throw new Error('expected option element');
    expect(option.selected).toBe(true);
  });

  it('sets .selected property on <option> for false', () => {
    const frag = html`<select><option value="a" selected="${true}">A</option><option value="b" selected="${false}">B</option></select>`;
    const select = frag.nodes[0] as HTMLSelectElement;
    const optB = select.options.item(1);
    if (optB === null) throw new Error('expected second option element');
    expect(optB.selected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static child Fragment disposal propagation
// ---------------------------------------------------------------------------

describe('static child Fragment disposal', () => {
  it('disposes a statically interpolated Fragment when the parent is disposed (AC1)', () => {
    const s = signal(0);
    const child = html`<span>${s}</span>`;
    const span = child.nodes[0] as HTMLElement;
    const parent = html`<div>${child}</div>`;

    expect(span.textContent).toBe('0');
    s.set(1);
    flush();
    expect(span.textContent).toBe('1');

    parent.dispose();
    s.set(2);
    flush();
    expect(span.textContent).toBe('1');
  });

  it('disposes each item Fragment in a static array when the parent is disposed (AC4)', () => {
    const s = signal(0);
    const items = [html`<li>${s}</li>`, html`<li>static</li>`];
    const li0 = items[0]?.nodes[0] as HTMLElement;
    const parent = html`<ul>${items}</ul>`;

    expect(li0.textContent).toBe('0');
    s.set(1);
    flush();
    expect(li0.textContent).toBe('1');

    parent.dispose();
    s.set(2);
    flush();
    expect(li0.textContent).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Composed attribute values (issue 059)
// ---------------------------------------------------------------------------

describe('composed attribute values', () => {
  it('composes a literal prefix with a hole and leaks no marker (AC1)', () => {
    const frag = html`<a href="/books/${'123'}">x</a>`;
    const a = frag.nodes[0] as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/books/123');
    expect(a.getAttribute('href')).not.toContain('<!--');
    expect(a.getAttribute('href')).not.toContain('__tmvc');
  });

  it('composes a class prefix with a hole (AC2)', () => {
    const frag = html`<div class="card ${'active'}"></div>`;
    const div = frag.nodes[0] as HTMLElement;
    expect(div.getAttribute('class')).toBe('card active');
  });

  it('composes a prefix and a suffix around a hole (AC3)', () => {
    const frag = html`<div data-label="width: ${10}px"></div>`;
    const div = frag.nodes[0] as HTMLElement;
    expect(div.getAttribute('data-label')).toBe('width: 10px');
  });

  it('composes multiple holes in order (AC4)', () => {
    const frag = html`<div class="${'a'} ${'b'}"></div>`;
    const div = frag.nodes[0] as HTMLElement;
    expect(div.getAttribute('class')).toBe('a b');
  });

  it('updates a composed value when a signal hole changes and stops after dispose (AC5)', () => {
    const cls = signal('one');
    const frag = html`<div class="box ${cls}"></div>`;
    const div = frag.nodes[0] as HTMLElement;
    expect(div.getAttribute('class')).toBe('box one');

    cls.set('two');
    flush();
    expect(div.getAttribute('class')).toBe('box two');

    frag.dispose();
    cls.set('three');
    flush();
    expect(div.getAttribute('class')).toBe('box two');
  });

  it('sanitizes the composed value for a URL attribute (AC6)', () => {
    const frag = html`<a href="javascript:${'alert(1)'}">x</a>`;
    const a = frag.nodes[0] as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('#');
  });

  it('keeps whole-value attribute bindings working (AC7)', () => {
    const frag = html`<a href="${'/about'}">x</a>`;
    const a = frag.nodes[0] as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/about');
  });

  it('throws for an event attribute combined with literal text (AC9)', () => {
    const handler = (): void => undefined;
    expect(() => html`<button onclick="run ${handler}">x</button>`).toThrow('[TypeMVC]');
  });

  it('throws for an event attribute with more than one expression (AC9)', () => {
    const a = (): void => undefined;
    const b = (): void => undefined;
    expect(() => html`<button onclick="${a}${b}">x</button>`).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// Reactive regions: a signal in node position
// ---------------------------------------------------------------------------

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('reactive region: a Signal<Fragment> at the root of a template', () => {
  it('replaces its content on update without a wrapper element', () => {
    const region = signal(html`<p>one</p>`);
    const frag = html`${region}`;
    const host = mount(frag);
    expect(host.textContent).toBe('one');

    region.set(html`<p>two</p>`);
    flush();

    expect(host.textContent).toBe('two');
    expect(host.querySelectorAll('p')).toHaveLength(1);
  });

  it('updates two adjacent root level regions independently', () => {
    const left = signal(html`<p>L1</p>`);
    const right = signal(html`<p>R1</p>`);
    const host = mount(html`${left}${right}`);
    expect(host.textContent).toBe('L1R1');

    left.set(html`<p>L2</p>`);
    flush();
    expect(host.textContent).toBe('L2R1');

    right.set(html`<p>R2</p>`);
    flush();
    expect(host.textContent).toBe('L2R2');
  });

  it('skips the swap when the signal is set to the same fragment instance', () => {
    const only = html`<p>same</p>`;
    const p = only.nodes[0] as HTMLElement;
    const region = signal(only);
    const host = mount(html`<div>${region}</div>`);

    region.set(only);
    flush();

    expect(host.querySelector('p')).toBe(p);
  });
});

describe('reactive region: arrays', () => {
  it('renders and re-renders a list of plain unkeyed fragments', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const items = signal(['a', 'b']);
    const rows = computed(() => items.get().map((i) => html`<li>${i}</li>`));
    const host = mount(html`<ul>${rows}</ul>`);

    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.textContent).toBe('ab');

    items.set(['c', 'd', 'e']);
    flush();

    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(host.textContent).toBe('cde');
  });

  it('reconciles a keyed list by key across a reorder', () => {
    const ids = signal([1, 2, 3]);
    const rows = computed(() => ids.get().map((id) => keyed(id, html`<li>${String(id)}</li>`)));
    const host = mount(html`<ul>${rows}</ul>`);
    const first = host.querySelectorAll('li')[0];

    ids.set([3, 1, 2]);
    flush();

    const after = host.querySelectorAll('li');
    expect(Array.from(after).map((li) => li.textContent)).toEqual(['3', '1', '2']);
    // The row kept its DOM node: it moved rather than being rebuilt.
    expect(after[1]).toBe(first);
  });

  it('throws when a list mixes keyed and unkeyed items', () => {
    const rows = signal<unknown[]>([keyed('a', html`<li>a</li>`), html`<li>b</li>`]);
    expect(() => html`<ul>${rows}</ul>`).toThrow('[TypeMVC]');
  });

  it('keeps reconciling by key when a list holds a nullish item, which renders nothing', () => {
    const rows = signal<unknown[]>([keyed('a', html`<li>a</li>`), null]);
    const host = mount(html`<ul>${rows}</ul>`);

    expect(host.querySelectorAll('li')).toHaveLength(1);

    rows.set([keyed('a', html`<li>a</li>`), keyed('b', html`<li>b</li>`)]);
    flush();

    expect(host.textContent).toBe('ab');
  });

  it('warns once per region for an unkeyed list of fragments and names keyed()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const items = signal(['a']);
    const rows = computed(() => items.get().map((i) => html`<li>${i}</li>`));
    mount(html`<ul>${rows}</ul>`);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('keyed(');

    items.set(['a', 'b']);
    flush();
    items.set(['c']);
    flush();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for a keyed list', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ids = signal([1]);
    const rows = computed(() => ids.get().map((id) => keyed(id, html`<li>${String(id)}</li>`)));
    mount(html`<ul>${rows}</ul>`);

    ids.set([1, 2]);
    flush();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('reactive region: value shapes', () => {
  it('renders the markup of a Signal<SafeHtml>, matching the static branch', () => {
    const markup = signal(safeHtml('<b>bold</b>'));
    const host = mount(html`<div>${markup}</div>`);
    expect(host.querySelector('b')?.textContent).toBe('bold');

    markup.set(safeHtml('<i>italic</i>'));
    flush();

    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('i')?.textContent).toBe('italic');
  });

  it('renders nothing for a nullish or false signal, not the text "null"', () => {
    const value = signal<string | null | undefined | false>(null);
    const host = mount(html`<div>${value}</div>`);
    expect(host.textContent).toBe('');

    value.set(undefined);
    flush();
    expect(host.textContent).toBe('');

    value.set(false);
    flush();
    expect(host.textContent).toBe('');

    value.set('now set');
    flush();
    expect(host.textContent).toBe('now set');
  });

  it('renders correctly across every shape change', () => {
    const value = signal<unknown>('scalar');
    const host = mount(html`<div>${value}</div>`);
    expect(host.textContent).toBe('scalar');

    value.set(html`<p>fragment</p>`);
    flush();
    expect(host.querySelector('p')?.textContent).toBe('fragment');

    value.set(null);
    flush();
    expect(host.textContent).toBe('');
    expect(host.querySelector('p')).toBeNull();

    value.set(html`<p>back</p>`);
    flush();
    expect(host.querySelector('p')?.textContent).toBe('back');

    value.set([]);
    flush();
    expect(host.textContent).toBe('');

    value.set([keyed('x', html`<li>x</li>`), keyed('y', html`<li>y</li>`)]);
    flush();
    expect(host.querySelectorAll('li')).toHaveLength(2);

    value.set(html`<p>last</p>`);
    flush();
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.querySelector('p')?.textContent).toBe('last');

    value.set(safeHtml('<b>raw</b>'));
    flush();
    expect(host.querySelector('p')).toBeNull();
    expect(host.querySelector('b')?.textContent).toBe('raw');

    value.set(42);
    flush();
    expect(host.textContent).toBe('42');
  });

  it('throws for an object value in a region', () => {
    const value = signal<unknown>({ a: 1 });
    expect(() => html`<div>${value}</div>`).toThrow('[TypeMVC]');
  });
});

describe('reactive region: disposal', () => {
  it('disposes the outgoing fragment on a fragment swap', () => {
    const inner = signal('first');
    const outgoing = html`<p>${inner}</p>`;
    const p = outgoing.nodes[0] as HTMLElement;
    const region = signal<unknown>(outgoing);
    mount(html`<div>${region}</div>`);

    region.set(html`<p>replacement</p>`);
    flush();

    inner.set('changed');
    flush();
    expect(p.textContent).toBe('first');
  });

  it('disposes the outgoing list when the shape changes from list to fragment', () => {
    const cell = signal('a');
    const rows = [html`<li>${cell}</li>`];
    const li = rows[0]?.nodes[0] as HTMLElement;
    const region = signal<unknown>(rows);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mount(html`<ul>${region}</ul>`);

    region.set(html`<li>single</li>`);
    flush();

    cell.set('b');
    flush();
    expect(li.textContent).toBe('a');
  });

  it('disposes the mounted content when the owning fragment is disposed', () => {
    const inner = signal('live');
    const region = signal<unknown>(html`<p>${inner}</p>`);
    const owner = html`<div>${region}</div>`;
    const host = mount(owner);
    const p = host.querySelector('p');

    owner.dispose();
    inner.set('dead');
    flush();

    expect(p?.textContent).toBe('live');
  });

  it('stops updating the region after the owning fragment is disposed', () => {
    const region = signal<unknown>('one');
    const owner = html`<div>${region}</div>`;
    const host = mount(owner);

    owner.dispose();
    region.set('two');
    flush();

    expect(host.textContent).toBe('one');
  });
});

// ---------------------------------------------------------------------------
// Element refs
// ---------------------------------------------------------------------------

describe('ref attribute', () => {
  it('hands the connected element to the callback and removes the attribute', () => {
    let received: Element | null = null;
    let connected = false;
    const frag = html`<input ref="${(el: Element) => {
      received = el;
      connected = el.isConnected;
    }}" />`;
    const input = frag.nodes[0] as HTMLInputElement;

    // The callback waits for the mount: an unmounted element cannot be focused
    // or measured.
    expect(received).toBeNull();

    const host = mount(frag);

    expect(received).toBe(input);
    expect(connected).toBe(true);
    expect(host.querySelector('input')?.hasAttribute('ref')).toBe(false);
  });

  it('runs the returned teardown once, on disposal and not before', () => {
    let cleanups = 0;
    const frag = html`<canvas ref="${() => () => { cleanups++; }}"></canvas>`;
    mount(frag);
    expect(cleanups).toBe(0);

    frag.dispose();
    expect(cleanups).toBe(1);

    frag.dispose();
    expect(cleanups).toBe(1);
  });

  it('runs once per row in a keyed list and tears down the row that is removed', () => {
    const mounts: string[] = [];
    const teardowns: string[] = [];
    const row = (id: string): Fragment =>
      html`<li ref="${() => {
        mounts.push(id);
        return () => teardowns.push(id);
      }}">${id}</li>`;

    const ids = signal(['a', 'b']);
    const rows = computed(() => ids.get().map((id) => keyed(id, row(id))));
    mount(html`<ul>${rows}</ul>`);

    expect(mounts).toEqual(['a', 'b']);
    expect(teardowns).toEqual([]);

    ids.set(['a']);
    flush();

    expect(mounts).toEqual(['a', 'b']);
    expect(teardowns).toEqual(['b']);
  });

  it('runs on each new fragment mounted into a reactive region', () => {
    const mounts: string[] = [];
    const teardowns: string[] = [];
    const panel = (name: string): Fragment =>
      html`<section ref="${() => {
        mounts.push(name);
        return () => teardowns.push(name);
      }}">${name}</section>`;

    const region = signal(panel('first'));
    mount(html`<div>${region}</div>`);
    expect(mounts).toEqual(['first']);

    region.set(panel('second'));
    flush();

    expect(mounts).toEqual(['first', 'second']);
    expect(teardowns).toEqual(['first']);
  });

  it('runs for a component fragment used statically in a view and tears down with it', () => {
    let mounted: Element | null = null;
    let torndown = false;
    const component = (): Fragment =>
      html`<input ref="${(el: Element) => {
        mounted = el;
        return () => { torndown = true; };
      }}" />`;

    const view = html`<div><h1>Title</h1>${component()}</div>`;
    expect(mounted).toBeNull();

    const host = mount(view);
    expect(mounted).toBe(host.querySelector('input'));
    expect(torndown).toBe(false);

    view.dispose();
    expect(torndown).toBe(true);
  });

  it('throws for a non function ref value', () => {
    expect(() => html`<input ref="${'focus'}" />`).toThrow('[TypeMVC]');
    expect(() => html`<input ref="${null}" />`).toThrow('[TypeMVC]');
  });

  it('throws for a ref combined with literal text', () => {
    const cb = (): void => undefined;
    expect(() => html`<input ref="a ${cb}" />`).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// class:name bindings
// ---------------------------------------------------------------------------

describe('class: bindings', () => {
  it('adds the class for a truthy value and leaves it off for a falsy one', () => {
    const on = mount(html`<button class:is-active="${true}">Open</button>`);
    const off = mount(html`<button class:is-active="${false}">Open</button>`);

    expect(on.querySelector('button')?.classList.contains('is-active')).toBe(true);
    expect(off.querySelector('button')?.classList.contains('is-active')).toBe(false);
  });

  it('coerces a non boolean value to a condition', () => {
    const host = mount(html`<i class:a="${'text'}" class:b="${0}" class:c="${null}"></i>`);
    const el = host.querySelector('i');

    expect(el?.classList.contains('a')).toBe(true);
    expect(el?.classList.contains('b')).toBe(false);
    expect(el?.classList.contains('c')).toBe(false);
  });

  it('toggles the class when its signal changes without rewriting the other tokens', () => {
    const active = signal(false);
    const host = mount(html`<li class="palette__item" class:is-active="${active}">Item</li>`);
    const el = host.querySelector('li');

    expect(el?.className).toBe('palette__item');

    active.set(true);
    flush();
    expect(el?.classList.contains('palette__item')).toBe(true);
    expect(el?.classList.contains('is-active')).toBe(true);

    active.set(false);
    flush();
    expect(el?.classList.contains('palette__item')).toBe(true);
    expect(el?.classList.contains('is-active')).toBe(false);
  });

  it('composes with a static class attribute written after the binding', () => {
    const host = mount(html`<span class:is-done="${true}" class="step">1</span>`);
    const el = host.querySelector('span');

    expect(el?.classList.contains('step')).toBe(true);
    expect(el?.classList.contains('is-done')).toBe(true);
  });

  it('composes several class bindings with a static class attribute', () => {
    const host = mount(
      html`<span class="step" class:is-done="${true}" class:is-current="${true}">1</span>`,
    );
    const el = host.querySelector('span');

    expect(el?.classList.contains('step')).toBe(true);
    expect(el?.classList.contains('is-done')).toBe(true);
    expect(el?.classList.contains('is-current')).toBe(true);
  });

  it('gives each class binding its own effect', () => {
    const done = signal(false);
    const current = signal(false);
    let doneReads = 0;
    const doneProbe = {
      get: (): boolean => {
        doneReads++;
        return done.get();
      },
    };

    const host = mount(
      html`<span class:is-done="${doneProbe}" class:is-current="${current}">1</span>`,
    );
    const el = host.querySelector('span');
    expect(doneReads).toBe(1);

    current.set(true);
    flush();

    expect(el?.classList.contains('is-current')).toBe(true);
    expect(doneReads).toBe(1);
  });

  it('binds a class name carrying hyphens and a BEM suffix', () => {
    const host = mount(html`<a class:palette__item--active="${true}">x</a>`);

    expect(host.querySelector('a')?.classList.contains('palette__item--active')).toBe(true);
  });

  it('removes the authoring attribute from the element', () => {
    const host = mount(html`<button class:is-active="${true}">Open</button>`);
    const el = host.querySelector('button');

    expect(el?.hasAttribute('class:is-active')).toBe(false);
    expect(el?.classList.contains('is-active')).toBe(true);
  });

  it('throws for a value combined with literal text', () => {
    expect(() => html`<i class:is-active="is-${'active'}"></i>`).toThrow('[TypeMVC]');
  });

  it('throws for a value combined with another expression', () => {
    expect(() => html`<i class:is-active="${true}${false}"></i>`).toThrow('[TypeMVC]');
  });

  it('throws when the prefix carries no class name', () => {
    expect(() => html`<i class:="${true}"></i>`).toThrow('[TypeMVC]');
  });

  it('stops responding to its signal once the owning fragment is disposed', () => {
    const active = signal(false);
    const frag = html`<li class:is-active="${active}">Item</li>`;
    const host = mount(frag);
    const el = host.querySelector('li');

    frag.dispose();
    active.set(true);
    flush();

    expect(el?.classList.contains('is-active')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// style:property bindings
// ---------------------------------------------------------------------------

describe('style: bindings', () => {
  it('sets a custom property readable from the computed style', () => {
    const host = mount(html`<div class="bars__bar" style:--fill="${'40%'}"></div>`);
    const el = host.querySelector('div');
    if (el === null) throw new Error('element not rendered');

    expect(getComputedStyle(el).getPropertyValue('--fill')).toBe('40%');
  });

  it('updates the property when its signal changes', () => {
    const fill = signal('10%');
    const host = mount(html`<div style:--fill="${fill}"></div>`);
    const el = host.querySelector('div');
    if (el === null) throw new Error('element not rendered');

    expect(el.style.getPropertyValue('--fill')).toBe('10%');

    fill.set('70%');
    flush();
    expect(el.style.getPropertyValue('--fill')).toBe('70%');
  });

  it('writes a number as a bare string so the stylesheet owns the unit', () => {
    const host = mount(html`<div style:--fill="${0.4}"></div>`);

    expect(host.querySelector('div')?.style.getPropertyValue('--fill')).toBe('0.4');
  });

  it('withdraws the property for null, undefined, false and the empty string', () => {
    const fill = signal<string | null | undefined | false>('40%');
    const host = mount(html`<div style:--fill="${fill}"></div>`);
    const el = host.querySelector('div');
    if (el === null) throw new Error('element not rendered');

    for (const empty of [null, undefined, false, ''] as const) {
      fill.set('40%');
      flush();
      expect(el.style.getPropertyValue('--fill')).toBe('40%');

      fill.set(empty);
      flush();
      expect(el.style.getPropertyValue('--fill')).toBe('');
      expect(el.getAttribute('style') ?? '').not.toContain('null');
    }
  });

  it('applies a plain CSS property as well as a custom one', () => {
    const width = signal('120px');
    const host = mount(html`<div style:width="${width}"></div>`);
    const el = host.querySelector('div');
    if (el === null) throw new Error('element not rendered');

    expect(getComputedStyle(el).getPropertyValue('width')).toBe('120px');

    width.set('20px');
    flush();
    expect(getComputedStyle(el).getPropertyValue('width')).toBe('20px');
  });

  it('composes literal text with holes and stays reactive', () => {
    const percent = signal(40);
    const host = mount(html`<div style:--fill="${percent}%"></div>`);
    const el = host.querySelector('div');
    if (el === null) throw new Error('element not rendered');

    expect(el.style.getPropertyValue('--fill')).toBe('40%');

    percent.set(75);
    flush();
    expect(el.style.getPropertyValue('--fill')).toBe('75%');
  });

  it('assigns through the CSSOM, which a strict style-src-attr policy allows', () => {
    // Assigning a style attribute is governed by style-src-attr and needs
    // unsafe-inline; assigning through the CSSOM is not. So the value must reach
    // the element through setProperty, which is what this pins. The declaration
    // is reflected back into the style attribute by the DOM afterwards, and that
    // reflection is not a policy check.
    const el = document.createElement('div');
    const setProperty = vi.spyOn(Object.getPrototypeOf(el.style) as CSSStyleDeclaration, 'setProperty');

    const host = mount(html`<div class="bars__bar" style:--fill="${'40%'}"></div>`);
    const calls = [...setProperty.mock.calls];
    setProperty.mockRestore();

    expect(calls).toContainEqual(['--fill', '40%']);
    expect(host.querySelector('div')?.style.getPropertyValue('--fill')).toBe('40%');
  });

  it('keeps two style bindings independent and preserves a static style attribute', () => {
    const x = signal('10');
    const y = signal('20');
    const host = mount(html`<div style="color: red" style:--x="${x}" style:--y="${y}"></div>`);
    const el = host.querySelector('div');
    if (el === null) throw new Error('element not rendered');

    expect(el.style.getPropertyValue('color')).toBe('red');
    expect(el.style.getPropertyValue('--x')).toBe('10');
    expect(el.style.getPropertyValue('--y')).toBe('20');

    x.set('99');
    flush();

    expect(el.style.getPropertyValue('--x')).toBe('99');
    expect(el.style.getPropertyValue('--y')).toBe('20');
    expect(el.style.getPropertyValue('color')).toBe('red');
  });

  it('gives each style binding its own effect', () => {
    const x = signal('10');
    const y = signal('20');
    let xReads = 0;
    const xProbe = {
      get: (): string => {
        xReads++;
        return x.get();
      },
    };

    mount(html`<div style:--x="${xProbe}" style:--y="${y}"></div>`);
    expect(xReads).toBe(1);

    y.set('40');
    flush();

    expect(xReads).toBe(1);
  });

  it('removes the authoring attribute from the element', () => {
    const host = mount(html`<div style:--fill="${'40%'}"></div>`);

    expect(host.querySelector('div')?.hasAttribute('style:--fill')).toBe(false);
  });

  it('throws when the prefix carries no property name', () => {
    expect(() => html`<div style:="${'40%'}"></div>`).toThrow('[TypeMVC]');
  });

  it('stops responding to its signal once the owning fragment is disposed', () => {
    const fill = signal('10%');
    const frag = html`<div style:--fill="${fill}"></div>`;
    const host = mount(frag);
    const el = host.querySelector('div');

    frag.dispose();
    fill.set('90%');
    flush();

    expect(el?.style.getPropertyValue('--fill')).toBe('10%');
  });
});

// ---------------------------------------------------------------------------
// Prefixed bindings inside a reactive region
// ---------------------------------------------------------------------------

describe('prefixed bindings inside a keyed list', () => {
  it('binds class and style on rows the reconciler rebuilds', () => {
    const selected = signal('a');
    const rows = signal([
      { id: 'a', width: '10%' },
      { id: 'b', width: '60%' },
    ]);
    const list = computed(() =>
      rows.get().map((row) =>
        keyed(
          row.id,
          html`<li
            class="row"
            class:is-selected="${computed(() => selected.get() === row.id)}"
            style:--w="${row.width}"
          ></li>`,
        ),
      ),
    );

    const host = mount(html`<ul>${list}</ul>`);
    const items = (): HTMLLIElement[] => Array.from(host.querySelectorAll('li'));

    expect(items()[0]?.classList.contains('is-selected')).toBe(true);
    expect(items()[1]?.classList.contains('is-selected')).toBe(false);
    expect(items()[1]?.style.getPropertyValue('--w')).toBe('60%');

    selected.set('b');
    flush();

    expect(items()[0]?.classList.contains('is-selected')).toBe(false);
    expect(items()[1]?.classList.contains('is-selected')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// class and style attributes keep their unprefixed behaviour
// ---------------------------------------------------------------------------

describe('unprefixed class and style attributes', () => {
  it('composes a multi part class attribute as before', () => {
    const active = signal(true);
    const host = mount(
      html`<i class="palette__item ${computed(() => (active.get() ? 'is-active' : ''))}"></i>`,
    );
    const el = host.querySelector('i');

    expect(el?.getAttribute('class')).toBe('palette__item is-active');

    active.set(false);
    flush();
    expect(el?.getAttribute('class')).toBe('palette__item ');
  });

  it('sets a whole value style attribute as before', () => {
    const host = mount(html`<div style="${'color: red'}"></div>`);

    expect(host.querySelector('div')?.getAttribute('style')).toBe('color: red');
  });
});
