// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { signal, computed } from '../../src/reactivity/signal.js';
import { drain } from '../../src/reactivity/scheduler.js';
import { html } from '../../src/renderer/html.js';
import { keyedList } from '../../src/renderer/keyed-list.js';
import type { Fragment } from '../../src/renderer/fragment.js';

function mount(fragment: Fragment): HTMLElement {
  const host = document.createElement('div');
  host.append(...fragment.nodes);
  fragment.mount();
  return host;
}

function liTexts(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll('li')).map((li) => li.textContent);
}

describe('keyedList', () => {
  it('reads the current item in a handler after an in-place update', () => {
    const items = signal([{ id: 'a', count: 0 }]);
    const clicks: number[] = [];
    const list = keyedList(
      items,
      (i) => i.id,
      (item) =>
        html`<button onclick="${() => clicks.push(item.get().count)}">${computed(() =>
          String(item.get().count),
        )}</button>`,
    );
    const host = mount(list);
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('0');

    items.set([{ id: 'a', count: 5 }]);
    drain();

    // Same node, updated content.
    expect(host.querySelector('button')).toBe(button);
    expect(button?.textContent).toBe('5');

    // The handler reads the current item, not the one captured at build time.
    button?.dispatchEvent(new Event('click'));
    expect(clicks).toEqual([5]);
  });

  it('preserves node identity across a reorder', () => {
    const items = signal([{ id: 'a' }, { id: 'b' }]);
    const list = keyedList(items, (i) => i.id, (item) => html`<li>${computed(() => item.get().id)}</li>`);
    const host = mount(list);
    const [liA, liB] = Array.from(host.querySelectorAll('li'));

    items.set([{ id: 'b' }, { id: 'a' }]);
    drain();

    const after = Array.from(host.querySelectorAll('li'));
    expect(after[0]).toBe(liB);
    expect(after[1]).toBe(liA);
  });

  it('updates a same-key row and removes a vanished key', () => {
    const items = signal([
      { id: 'a', t: 'A' },
      { id: 'b', t: 'B' },
    ]);
    const list = keyedList(items, (i) => i.id, (item) => html`<li>${computed(() => item.get().t)}</li>`);
    const host = mount(list);
    expect(liTexts(host)).toEqual(['A', 'B']);

    items.set([{ id: 'b', t: 'B2' }]);
    drain();

    expect(liTexts(host)).toEqual(['B2']);
  });

  it('inserts a new key at the correct position', () => {
    const items = signal([{ id: 'a' }, { id: 'c' }]);
    const list = keyedList(items, (i) => i.id, (item) => html`<li>${computed(() => item.get().id)}</li>`);
    const host = mount(list);
    expect(liTexts(host)).toEqual(['a', 'c']);

    items.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    drain();

    expect(liTexts(host)).toEqual(['a', 'b', 'c']);
  });

  it('does not rebuild a row when its item changes, keeping its node', () => {
    const items = signal([{ id: 'a', n: 1 }]);
    let builds = 0;
    const list = keyedList(items, (i) => i.id, (item) => {
      builds++;
      return html`<li>${computed(() => String(item.get().n))}</li>`;
    });
    const host = mount(list);
    const li = host.querySelector('li');
    expect(builds).toBe(1);

    items.set([{ id: 'a', n: 2 }]);
    drain();

    expect(builds).toBe(1);
    expect(host.querySelector('li')).toBe(li);
    expect(li?.textContent).toBe('2');
  });

  it('is exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(typeof barrel.keyedList).toBe('function');
  });
});
