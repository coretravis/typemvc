// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';
import { html } from '../../src/renderer/html.js';
import { keyed } from '../../src/renderer/keyed.js';
import type { KeyedFragment } from '../../src/renderer/keyed.js';
import { clearRegion, reconcile } from '../../src/renderer/reconciler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegion(): { parent: HTMLElement; start: Comment; end: Comment } {
  const parent = document.createElement('ul');
  const start = document.createComment('tmvc-rc-start');
  const end = document.createComment('tmvc-rc-end');
  parent.append(start, end);
  return { parent, start, end };
}

function itemTexts(parent: HTMLElement): string[] {
  return Array.from(parent.querySelectorAll('li')).map((li) => li.textContent);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// clearRegion
// ---------------------------------------------------------------------------

describe('clearRegion', () => {
  it('removes all nodes between the two sentinels', () => {
    const parent = document.createElement('div');
    const start = document.createComment('start');
    const end = document.createComment('end');
    const child1 = document.createElement('p');
    const child2 = document.createElement('span');
    parent.append(start, child1, child2, end);

    clearRegion(start, end);

    expect(parent.childNodes).toHaveLength(2);
    expect(parent.childNodes[0]).toBe(start);
    expect(parent.childNodes[1]).toBe(end);
  });

  it('is a no-op when the region is already empty', () => {
    const parent = document.createElement('div');
    const start = document.createComment('start');
    const end = document.createComment('end');
    parent.append(start, end);

    expect(() => { clearRegion(start, end); }).not.toThrow();
    expect(parent.childNodes).toHaveLength(2);
  });

  it('does not remove nodes outside the sentinel range', () => {
    const parent = document.createElement('div');
    const outside = document.createElement('header');
    const start = document.createComment('start');
    const inner = document.createElement('p');
    const end = document.createComment('end');
    const tail = document.createElement('footer');
    parent.append(outside, start, inner, end, tail);

    clearRegion(start, end);

    expect(parent.contains(outside)).toBe(true);
    expect(parent.contains(tail)).toBe(true);
    expect(parent.contains(inner)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reconcile -- initial insertion
// ---------------------------------------------------------------------------

describe('reconcile -- initial insertion', () => {
  it('inserts all items into an empty region (AC3)', () => {
    const { end } = makeRegion();
    const oldMap = new Map<string | number, KeyedFragment>();

    reconcile(end, oldMap, [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toEqual(['A', 'B', 'C']);
  });

  it('produces an empty region for an empty list', () => {
    const { parent, start, end } = makeRegion();
    reconcile(end, new Map(), []);
    expect(parent.childNodes).toHaveLength(2);
    expect(parent.childNodes[0]).toBe(start);
    expect(parent.childNodes[1]).toBe(end);
  });
});

// ---------------------------------------------------------------------------
// reconcile -- insertion (AC4)
// ---------------------------------------------------------------------------

describe('reconcile -- insertion (AC4)', () => {
  it('inserts a new item in the middle at the correct position', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [
      keyed('a', html`<li>A</li>`),
      keyed('c', html`<li>C</li>`),
    ]);

    reconcile(end, keyMap, [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toEqual(['A', 'B', 'C']);
  });

  it('inserts a new item at the start', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [keyed('b', html`<li>B</li>`)]);

    reconcile(end, keyMap, [keyed('a', html`<li>A</li>`), keyed('b', html`<li>B</li>`)]);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toEqual(['A', 'B']);
  });

  it('inserts a new item at the end', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [keyed('a', html`<li>A</li>`)]);

    reconcile(end, keyMap, [keyed('a', html`<li>A</li>`), keyed('b', html`<li>B</li>`)]);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// reconcile -- removal (AC5)
// ---------------------------------------------------------------------------

describe('reconcile -- removal (AC5)', () => {
  it('removes an item from the middle', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    const liB = parent.querySelector('li:nth-child(2)');

    reconcile(end, keyMap, [keyed('a', html`<li>A</li>`), keyed('c', html`<li>C</li>`)]);

    expect(itemTexts(parent)).toEqual(['A', 'C']);
    expect(liB?.parentNode).toBeNull();
  });

  it('empties the list when new list is empty', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
    ]);

    reconcile(end, keyMap, []);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reconcile -- reorder (AC6)
// ---------------------------------------------------------------------------

describe('reconcile -- reorder (AC6)', () => {
  it('moves nodes without recreating them', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    const liA = parent.children[0];
    const liB = parent.children[1];
    const liC = parent.children[2];

    reconcile(end, keyMap, [
      keyed('c', html`<li>C</li>`),
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
    ]);

    expect(parent.children[0]).toBe(liC);
    expect(parent.children[1]).toBe(liA);
    expect(parent.children[2]).toBe(liB);
  });

  it('handles full reversal correctly', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);

    reconcile(end, keyMap, [
      keyed('c', html`<li>C</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('a', html`<li>A</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toEqual(['C', 'B', 'A']);
  });

  it('is a no-op when order is already correct', () => {
    const { end } = makeRegion();
    const keyMap = reconcile(end, new Map(), [
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    const liA = parent.children[0];
    const liB = parent.children[1];

    reconcile(end, keyMap, [keyed('a', html`<li>A</li>`), keyed('b', html`<li>B</li>`)]);

    expect(parent.children[0]).toBe(liA);
    expect(parent.children[1]).toBe(liB);
  });
});

// ---------------------------------------------------------------------------
// reconcile -- duplicate keys (AC7)
// ---------------------------------------------------------------------------

describe('reconcile -- duplicate keys (AC7)', () => {
  it('skips the second occurrence and warns in DEV', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });
    const { end } = makeRegion();

    reconcile(end, new Map(), [
      keyed('a', html`<li>First A</li>`),
      keyed('a', html`<li>Dup A</li>`),
      keyed('b', html`<li>B</li>`),
    ]);

    const parent = end.parentNode as HTMLElement;
    expect(itemTexts(parent)).toEqual(['First A', 'B']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate key'));
  });
});

// ---------------------------------------------------------------------------
// Signal<Fragment> -- clear-and-replace (AC1)
// ---------------------------------------------------------------------------

describe('Signal<Fragment> binding (AC1)', () => {
  it('renders the initial Fragment value', () => {
    const s = signal(html`<p>hello</p>`);
    const frag = html`<div>${s}</div>`;
    const div = frag.nodes[0] as HTMLDivElement;
    expect(div.querySelector('p')?.textContent).toBe('hello');
  });

  it('replaces content when signal updates', () => {
    const s = signal(html`<p>initial</p>`);
    const frag = html`<div>${s}</div>`;
    const div = frag.nodes[0] as HTMLDivElement;

    s.set(html`<p>updated</p>`);
    flush();

    expect(div.querySelector('p')?.textContent).toBe('updated');
    expect(div.textContent).not.toContain('initial');
  });

  it('stops updating after the outer Fragment is disposed (AC8)', () => {
    const s = signal(html`<p>initial</p>`);
    const frag = html`<div>${s}</div>`;
    const div = frag.nodes[0] as HTMLDivElement;

    frag.dispose();
    s.set(html`<p>updated</p>`);
    flush();

    expect(div.textContent).toContain('initial');
    expect(div.textContent).not.toContain('updated');
  });
});

// ---------------------------------------------------------------------------
// Signal<KeyedFragment[]> -- full integration via html binding (AC3-AC8)
// ---------------------------------------------------------------------------

describe('Signal<KeyedFragment[]> binding (AC3-AC8)', () => {
  it('renders initial list (AC3)', () => {
    const s = signal([keyed('a', html`<li>A</li>`), keyed('b', html`<li>B</li>`)]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;

    expect(itemTexts(ul)).toEqual(['A', 'B']);
  });

  it('inserts new item at correct position (AC4)', () => {
    const s = signal([keyed('a', html`<li>A</li>`), keyed('c', html`<li>C</li>`)]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;

    s.set([
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);
    flush();

    expect(itemTexts(ul)).toEqual(['A', 'B', 'C']);
  });

  it('removes item from DOM when absent from new list (AC5)', () => {
    const s = signal([
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;
    const liB = ul.querySelector('li:nth-child(2)');

    s.set([keyed('a', html`<li>A</li>`), keyed('c', html`<li>C</li>`)]);
    flush();

    expect(itemTexts(ul)).toEqual(['A', 'C']);
    expect(liB?.parentNode).toBeNull();
  });

  it('moves existing DOM nodes without recreating them (AC6)', () => {
    const s = signal([
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
      keyed('c', html`<li>C</li>`),
    ]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;

    const liA = ul.children[0];
    const liB = ul.children[1];
    const liC = ul.children[2];

    s.set([
      keyed('c', html`<li>C</li>`),
      keyed('a', html`<li>A</li>`),
      keyed('b', html`<li>B</li>`),
    ]);
    flush();

    expect(ul.children[0]).toBe(liC);
    expect(ul.children[1]).toBe(liA);
    expect(ul.children[2]).toBe(liB);
  });

  it('warns on duplicate keys and skips second entry (AC7)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* suppress */ });

    const s = signal([
      keyed('a', html`<li>First A</li>`),
      keyed('a', html`<li>Dup A</li>`),
      keyed('b', html`<li>B</li>`),
    ]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;

    expect(itemTexts(ul)).toEqual(['First A', 'B']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate key'));
  });

  it('stops updating after outer Fragment is disposed (AC8)', () => {
    const s = signal([keyed('a', html`<li>A</li>`)]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;

    frag.dispose();
    s.set([keyed('a', html`<li>A</li>`), keyed('b', html`<li>B</li>`)]);
    flush();

    expect(ul.querySelectorAll('li')).toHaveLength(1);
  });

  it('handles initially empty list and populates on update', () => {
    const s = signal<ReturnType<typeof keyed>[]>([]);
    const frag = html`<ul>${s}</ul>`;
    const ul = frag.nodes[0] as HTMLUListElement;

    expect(ul.querySelectorAll('li')).toHaveLength(0);

    s.set([keyed('a', html`<li>A</li>`), keyed('b', html`<li>B</li>`)]);
    flush();

    expect(itemTexts(ul)).toEqual(['A', 'B']);
  });
});

// ---------------------------------------------------------------------------
// keyed() helper and barrel export (AC2)
// ---------------------------------------------------------------------------

describe('keyed() helper (AC2)', () => {
  it('returns an object with the given string key', () => {
    const kf = keyed('my-key', html`<li>item</li>`);
    expect(kf.key).toBe('my-key');
  });

  it('accepts numeric keys', () => {
    const kf = keyed(42, html`<li>item</li>`);
    expect(kf.key).toBe(42);
  });

  it('carries the fragment nodes', () => {
    const frag = html`<li>x</li>`;
    const kf = keyed('k', frag);
    expect(kf.nodes).toBe(frag.nodes);
  });

  it('retains the source fragment for disposal', () => {
    const frag = html`<li>x</li>`;
    const kf = keyed('k', frag);
    expect(kf.fragment).toBe(frag);
  });

  it('is exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(typeof barrel.keyed).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Fragment disposal on removal and replace (issue 054)
// ---------------------------------------------------------------------------

describe('reconcile -- disposes removed item fragments (AC1)', () => {
  it('disposes a removed item so its binding effects stop running', () => {
    const count = signal(0);
    const itemA = html`<li class="a">${count}</li>`;
    const liA = itemA.nodes[0] as HTMLElement;

    const { end } = makeRegion();
    let map = reconcile(end, new Map(), [keyed('a', itemA), keyed('b', html`<li>B</li>`)]);
    expect(liA.textContent).toBe('0');

    // Remove 'a'. Its fragment is disposed, so its text-binding effect stops.
    map = reconcile(end, map, [keyed('b', html`<li>B</li>`)]);
    count.set(99);
    flush();

    expect(liA.textContent).toBe('0');
    expect(map.has('a')).toBe(false);
  });

  it('does not dispose a reordered (retained) item (AC2)', () => {
    const count = signal(0);
    const itemA = html`<li class="a">${count}</li>`;
    const liA = itemA.nodes[0] as HTMLElement;

    const { end } = makeRegion();
    let map = reconcile(end, new Map(), [keyed('a', itemA), keyed('b', html`<li>B</li>`)]);
    expect(liA.textContent).toBe('0');

    // Reorder: 'a' is retained, so its live binding keeps updating.
    map = reconcile(end, map, [keyed('b', html`<li>B</li>`), keyed('a', html`<li class="a">${count}</li>`)]);
    count.set(7);
    flush();

    expect(liA.textContent).toBe('7');
    expect(map.get('a')?.nodes[0]).toBe(liA);
  });
});

describe('Signal<Fragment> binding -- disposes outgoing fragment (AC3, AC4)', () => {
  it('disposes the previous fragment when the signal is replaced (AC3)', () => {
    const count = signal(0);
    const f1 = html`<p>${count}</p>`;
    const p1 = f1.nodes[0] as HTMLElement;
    const s = signal<ReturnType<typeof html>>(f1);
    const frag = html`<div>${s}</div>`;
    expect((frag.nodes[0] as HTMLElement).contains(p1)).toBe(true);
    expect(p1.textContent).toBe('0');

    s.set(html`<p>second</p>`);
    flush();

    // f1 was disposed: its text-binding effect no longer responds to count.
    count.set(42);
    flush();
    expect(p1.textContent).toBe('0');
  });

  it('keeps the fragment live when set to the same instance (AC4)', () => {
    const count = signal(0);
    const f = html`<p>${count}</p>`;
    const p = f.nodes[0] as HTMLElement;
    const s = signal<ReturnType<typeof html>>(f);
    const frag = html`<div>${s}</div>`;
    const div = frag.nodes[0] as HTMLElement;

    s.set(f);
    flush();
    count.set(5);
    flush();

    expect(p.textContent).toBe('5');
    expect(div.contains(p)).toBe(true);
  });
});

describe('Fragment disposal on region teardown (AC5)', () => {
  it('disposes keyed items still mounted when the parent Fragment is disposed', () => {
    const count = signal(0);
    const itemA = html`<li>${count}</li>`;
    const liA = itemA.nodes[0] as HTMLElement;
    const s = signal([keyed('a', itemA)]);
    const frag = html`<ul>${s}</ul>`;
    expect(liA.textContent).toBe('0');

    frag.dispose();
    count.set(3);
    flush();

    expect(liA.textContent).toBe('0');
  });

  it('disposes the mounted Signal<Fragment> value when the parent Fragment is disposed', () => {
    const count = signal(0);
    const inner = html`<p>${count}</p>`;
    const p = inner.nodes[0] as HTMLElement;
    const s = signal<ReturnType<typeof html>>(inner);
    const frag = html`<div>${s}</div>`;
    expect(p.textContent).toBe('0');

    frag.dispose();
    count.set(8);
    flush();

    expect(p.textContent).toBe('0');
  });
});
