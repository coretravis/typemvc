// @vitest-environment happy-dom
/**
 * End-to-end tests for component children / slot projection.
 *
 * Verifies that <Tag>children</Tag> in a .tmvc view is parsed, the children are
 * passed to the component as a `children` Fragment prop, and the component
 * projects them into live DOM via ${props.children}.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseTmvc } from '../../src/runtime-parser/index.js';
import {
  _setComponentRegistry,
  _getComponentRegistry,
} from '../../src/core/component-registry.js';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import type { ComponentFunction, ViewContext } from '../../src/types/index.js';

// Minimal ViewContext stand-in; only the fields a template touches need to exist.
function makeContext(model: Record<string, unknown> = {}): ViewContext {
  return { model } as unknown as ViewContext;
}

function renderToRoot(fragment: Fragment): HTMLDivElement {
  const root = document.createElement('div');
  for (const node of fragment.nodes) root.appendChild(node);
  return root;
}

afterEach(() => {
  _setComponentRegistry(Object.create(null) as Record<string, ComponentFunction>);
});

describe('component children projection (runtime)', () => {
  it('projects text children into the component', () => {
    const Card: ComponentFunction = (props) =>
      html`<div class="card">${(props as { children: unknown }).children}</div>`;
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card>Hello world</Card>');
    const root = renderToRoot(view(makeContext()));

    const card = root.querySelector('.card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toBe('Hello world');
  });

  it('projects rich markup children including nested elements', () => {
    const Card: ComponentFunction = (props) =>
      html`<section class="card">${(props as { children: unknown }).children}</section>`;
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card>Hello <strong>world</strong></Card>');
    const root = renderToRoot(view(makeContext()));

    expect(root.querySelector('.card strong')?.textContent).toBe('world');
    expect(root.querySelector('.card')?.textContent).toBe('Hello world');
  });

  it('evaluates ${context...} expressions inside children', () => {
    const Card: ComponentFunction = (props) =>
      html`<div class="card">${(props as { children: unknown }).children}</div>`;
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card>Hi ${context.model.name}</Card>');
    const root = renderToRoot(view(makeContext({ name: 'Ada' })));

    expect(root.querySelector('.card')?.textContent).toBe('Hi Ada');
  });

  it('merges attributes and children on the same component', () => {
    const Card: ComponentFunction = (props) => {
      const p = props as { title: string; children: unknown };
      return html`<div class="card"><h2>${p.title}</h2><div class="body">${p.children}</div></div>`;
    };
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card title="Greeting">body text</Card>');
    const root = renderToRoot(view(makeContext()));

    expect(root.querySelector('.card h2')?.textContent).toBe('Greeting');
    expect(root.querySelector('.card .body')?.textContent).toBe('body text');
  });

  it('projects children through nested components', () => {
    const Outer: ComponentFunction = (props) =>
      html`<div class="outer">${(props as { children: unknown }).children}</div>`;
    const Inner: ComponentFunction = (props) =>
      html`<div class="inner">${(props as { children: unknown }).children}</div>`;
    _setComponentRegistry({ Outer, Inner });

    const view = parseTmvc('<Outer><Inner>deep</Inner></Outer>');
    const root = renderToRoot(view(makeContext()));

    expect(root.querySelector('.outer .inner')?.textContent).toBe('deep');
  });

  it('a component that ignores children still renders', () => {
    const Card: ComponentFunction = () => html`<div class="card">static</div>`;
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card>unused children</Card>');
    const root = renderToRoot(view(makeContext()));

    expect(root.querySelector('.card')?.textContent).toBe('static');
  });

  it('keeps the registry test-isolated (afterEach reset works)', () => {
    expect(Object.keys(_getComponentRegistry()).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Issue 047: named slots project as distinct props
// ---------------------------------------------------------------------------

describe('047: named slots (runtime)', () => {
  it('projects named slots and default children into the right regions', () => {
    const Card: ComponentFunction = (props) => {
      const p = props as { header?: unknown; footer?: unknown; children?: unknown };
      return html`<article class="card">
        <header>${p.header}</header>
        <main>${p.children}</main>
        <footer>${p.footer}</footer>
      </article>`;
    };
    _setComponentRegistry({ Card });

    const view = parseTmvc(
      '<Card><slot:header>Title</slot:header>Body text<slot:footer><button>Save</button></slot:footer></Card>',
    );
    const root = renderToRoot(view(makeContext()));

    expect(root.querySelector('.card header')?.textContent).toBe('Title');
    expect(root.querySelector('.card main')?.textContent).toContain('Body text');
    expect(root.querySelector('.card footer button')?.textContent).toBe('Save');
  });

  it('omits the children prop when there is no default content', () => {
    const Card: ComponentFunction = (props) => {
      const p = props as { header?: unknown; children?: unknown };
      return html`<div class="card"><h2>${p.header}</h2><div class="body">${p.children ?? 'EMPTY'}</div></div>`;
    };
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card><slot:header>Only header</slot:header></Card>');
    const root = renderToRoot(view(makeContext()));

    expect(root.querySelector('.card h2')?.textContent).toBe('Only header');
    expect(root.querySelector('.card .body')?.textContent).toBe('EMPTY');
  });

  it('evaluates expressions inside a named slot', () => {
    const Card: ComponentFunction = (props) =>
      html`<div class="card">${(props as { header?: unknown }).header}</div>`;
    _setComponentRegistry({ Card });

    const view = parseTmvc('<Card><slot:header>Hi ${context.model.name}</slot:header></Card>');
    const root = renderToRoot(view(makeContext({ name: 'Ada' })));

    expect(root.querySelector('.card')?.textContent).toBe('Hi Ada');
  });
});
