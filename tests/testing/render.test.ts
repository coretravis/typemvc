// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderTemplate, renderView, createTestContext, flushEffects } from '../../src/testing/index.js';
import '../../src/testing/vitest.js';
import { html } from '../../src/renderer/html.js';
import { signal } from '../../src/reactivity/signal.js';
import type { ViewContext } from '../../src/types/index.js';

describe('renderTemplate', () => {
  it('renders markup and exposes text/html/query', () => {
    const view = renderTemplate(() => html`<ul><li>Alice</li><li>Brian</li></ul>`);
    expect(view).toContainText('Alice');
    expect(view.queryAll('li')).toHaveLength(2);
    expect(view.query('li')?.textContent).toBe('Alice');
  });

  it('drives a click handler', () => {
    let clicked = 0;
    const view = renderTemplate(() => html`<button onclick=${() => { clicked += 1; }}>Go</button>`);
    view.click('button');
    expect(clicked).toBe(1);
  });

  it('drives an input handler with a value', () => {
    let captured = '';
    const view = renderTemplate(
      () => html`<input oninput=${(e: Event) => { captured = (e.target as HTMLInputElement).value; }} />`,
    );
    view.input('input', 'hello');
    expect(captured).toBe('hello');
  });

  it('reflects reactive updates after flushEffects', () => {
    const count = signal(0);
    const view = renderTemplate(() => html`<span>${count}</span>`);
    expect(view).toContainText('0');
    count.set(5);
    flushEffects();
    expect(view).toContainText('5');
  });
});

describe('renderView and createTestContext', () => {
  it('renders a view function with a test context', () => {
    const viewFn = (ctx: ViewContext): ReturnType<typeof html> =>
      html`<h1>${(ctx.model as { title: string }).title}</h1>`;
    const view = renderView(viewFn, { model: { title: 'Welcome' } });
    expect(view.query('h1')).toHaveText('Welcome');
  });

  it('createTestContext supplies sensible defaults and accepts overrides', () => {
    const ctx = createTestContext({ params: { id: '7' } });
    expect(ctx.params.id).toBe('7');
    expect(ctx.errors.action).toBeNull();
    expect(ctx.query).toBeInstanceOf(URLSearchParams);
  });
});
