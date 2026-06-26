// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { signal } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import { SafeHtml, safeHtml } from '../../src/renderer/safe-html.js';
import { renderValue, isReadonlySignal } from '../../src/renderer/binding.js';
import type { BindingContext, DisposeCollector } from '../../src/renderer/binding.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCollector(): DisposeCollector & { disposes: (() => void)[] } {
  const disposes: (() => void)[] = [];
  return {
    disposes,
    addDispose(fn: () => void): void {
      disposes.push(fn);
    },
  };
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
