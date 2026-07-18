// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { signal, computed } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { html, svg } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import { safeHtml } from '../../src/renderer/safe-html.js';
import { keyed } from '../../src/renderer/keyed.js';
import { stop, prevent } from '../../src/renderer/modifiers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function mount(frag: Fragment): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  for (const node of frag.nodes) host.appendChild(node);
  frag.mount();
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('svg tagged template', () => {
  it('is exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(typeof barrel.svg).toBe('function');
  });

  it('produces root elements in the SVG namespace', () => {
    const frag = svg`<circle r="10" />`;
    const circle = frag.nodes.find((n): n is Element => n instanceof Element);
    expect(circle?.namespaceURI).toBe(SVG_NS);
    expect(circle?.localName).toBe('circle');
  });

  it('puts every interpolated child of an <svg> in the SVG namespace', () => {
    const frag = html`<svg viewBox="0 0 40 40">${[1, 2].map((i) => svg`<circle r="${String(i)}" />`)}</svg>`;
    const host = mount(frag);
    const circles = host.querySelectorAll('circle');

    expect(circles).toHaveLength(2);
    for (const circle of circles) {
      expect(circle.namespaceURI).toBe(SVG_NS);
    }
    expect(circles[0]?.getAttribute('r')).toBe('1');
    expect(circles[1]?.getAttribute('r')).toBe('2');
  });

  it('binds events inside an svg template, including the stop and prevent modifiers', () => {
    let clicks = 0;
    let outerClicks = 0;
    const frag = html`<svg onclick="${() => { outerClicks++; }}">${svg`<circle
      r="5"
      onclick="${stop(() => { clicks++; })}"
    />`}</svg>`;
    const host = mount(frag);
    const circle = host.querySelector('circle');
    if (circle === null) throw new Error('expected a circle element');

    circle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicks).toBe(1);
    expect(outerClicks).toBe(0);
    expect(circle.hasAttribute('onclick')).toBe(false);

    const submit = html`<svg>${svg`<circle onclick="${prevent(() => undefined)}" />`}</svg>`;
    const svgHost = mount(submit);
    const target = svgHost.querySelector('circle');
    if (target === null) throw new Error('expected a circle element');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('updates an attribute bound to a signal inside an svg template', () => {
    const radius = signal('4');
    const host = mount(html`<svg>${svg`<circle r="${radius}" />`}</svg>`);
    const circle = host.querySelector('circle');

    expect(circle?.getAttribute('r')).toBe('4');

    radius.set('9');
    flush();

    expect(circle?.getAttribute('r')).toBe('9');
  });

  it('reconciles a keyed list of svg fragments inside an <svg> parent', () => {
    const ids = signal(['a', 'b', 'c']);
    const shapes = computed(() =>
      ids.get().map((id) => keyed(id, svg`<circle id="${id}" r="1" />`)),
    );
    const host = mount(html`<svg>${shapes}</svg>`);

    const before = host.querySelectorAll('circle');
    expect(before).toHaveLength(3);
    expect(before[0]?.namespaceURI).toBe(SVG_NS);
    const firstCircle = before[0];

    ids.set(['c', 'a']);
    flush();

    const after = host.querySelectorAll('circle');
    expect(Array.from(after).map((c) => c.getAttribute('id'))).toEqual(['c', 'a']);
    expect(after[1]).toBe(firstCircle);
    expect(after[0]?.namespaceURI).toBe(SVG_NS);
  });

  it('inserts SafeHtml into an SVG destination in the SVG namespace', () => {
    const host = mount(html`<svg>${safeHtml('<path d="M0 0" />')}</svg>`);
    const path = host.querySelector('path');

    expect(path?.namespaceURI).toBe(SVG_NS);
    expect(path?.getAttribute('d')).toBe('M0 0');
  });

  it('inserts SafeHtml into a non SVG destination unchanged', () => {
    const host = mount(html`<div>${safeHtml('<b>bold</b>')}</div>`);
    const bold = host.querySelector('b');

    expect(bold?.namespaceURI).toBe(XHTML_NS);
    expect(bold?.textContent).toBe('bold');
  });

  it('inserts a Signal<SafeHtml> into an SVG destination in the SVG namespace', () => {
    const markup = signal(safeHtml('<path d="M0 0" />'));
    const host = mount(html`<svg>${markup}</svg>`);

    expect(host.querySelector('path')?.namespaceURI).toBe(SVG_NS);

    markup.set(safeHtml('<rect width="2" height="2" />'));
    flush();

    expect(host.querySelector('path')).toBeNull();
    const rect = host.querySelector('rect');
    expect(rect?.namespaceURI).toBe(SVG_NS);
    expect(rect?.getAttribute('width')).toBe('2');
  });

  it('leaves a static <svg> in an html template in the SVG namespace', () => {
    const host = mount(html`<svg viewBox="0 0 24 24"><circle r="10" fill="red" /></svg>`);
    const root = host.querySelector('svg');
    const circle = host.querySelector('circle');

    expect(root?.namespaceURI).toBe(SVG_NS);
    expect(circle?.namespaceURI).toBe(SVG_NS);
    expect(root?.getAttribute('viewBox')).toBe('0 0 24 24');
  });
});

// ---------------------------------------------------------------------------
// Prefixed class and style bindings on SVG elements
// ---------------------------------------------------------------------------

describe('prefixed bindings on SVG elements', () => {
  it('toggles a class on an SVG element inside an svg template', () => {
    const hot = signal(false);
    const host = mount(
      html`<svg viewBox="0 0 24 24">${svg`<rect class="bar" class:is-hot="${hot}" />`}</svg>`,
    );
    const rect = host.querySelector('rect');

    expect(rect?.namespaceURI).toBe(SVG_NS);
    expect(rect?.classList.contains('is-hot')).toBe(false);

    hot.set(true);
    flush();

    expect(rect?.classList.contains('bar')).toBe(true);
    expect(rect?.classList.contains('is-hot')).toBe(true);
  });

  it('sets a custom property on an SVG element inside an svg template', () => {
    const height = signal('12');
    const host = mount(html`<svg>${svg`<rect style:--h="${height}" />`}</svg>`);
    const rect = host.querySelector('rect');
    if (rect === null) throw new Error('rect not rendered');

    expect(rect.style.getPropertyValue('--h')).toBe('12');
    expect(rect.hasAttribute('style:--h')).toBe(false);

    height.set('30');
    flush();

    expect(rect.style.getPropertyValue('--h')).toBe('30');
  });

  it('binds both prefixes on an SVG element written inside an html template', () => {
    const host = mount(
      html`<svg viewBox="0 0 24 24"><circle class:is-on="${true}" style:--r="${'4'}" /></svg>`,
    );
    const circle = host.querySelector('circle');

    expect(circle?.namespaceURI).toBe(SVG_NS);
    expect(circle?.classList.contains('is-on')).toBe(true);
    expect(circle?.style.getPropertyValue('--r')).toBe('4');
  });
});
