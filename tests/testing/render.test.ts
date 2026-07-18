// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  renderTemplate,
  renderView,
  renderComponent,
  registerComponents,
  resetComponents,
  createTestContext,
  flushEffects,
} from '../../src/testing/index.js';
import '../../src/testing/vitest.js';
import { html } from '../../src/renderer/html.js';
import { signal, computed, effect, onCleanup } from '../../src/reactivity/signal.js';
import { keyedMap } from '../../src/renderer/keyed.js';
import { _callComponent } from '../../src/core/component-registry.js';
import type { Fragment } from '../../src/renderer/fragment.js';
import type { ViewContext } from '../../src/types/index.js';

describe('flushEffects drains a cascading graph', () => {
  it('settles an effect that wakes another effect in a single flushEffects', () => {
    const a = signal(1);
    const b = signal(0);
    // This effect writes b, whose value the template reads: updating a wakes this
    // effect, which in turn wakes the template's text binding.
    const dispose = effect(() => { b.set(a.get() * 2); });

    const view = renderTemplate(() => html`<span>${b}</span>`);
    expect(view.query('span')?.textContent).toBe('2');

    a.set(5);
    flushEffects();

    expect(view.query('span')?.textContent).toBe('10');
    dispose();
  });
});

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

// ---------------------------------------------------------------------------
// Components. Each component here is written the way the compiler emits one: a
// function of props whose @local statements sit in the function body.
// ---------------------------------------------------------------------------

interface PillProps {
  label: string;
  tone: string;
}

function Pill(props: PillProps): Fragment {
  return html`<span class="pill pill--${props.tone}">${props.label}</span>`;
}

interface CounterProps {
  label: string;
  step: number;
}

function Counter(props: CounterProps): Fragment {
  const count = signal(0);
  const increment = (): void => {
    count.update((n) => n + props.step);
  };
  const reset = (): void => {
    count.set(0);
  };

  return html`<div class="counter">
    <span class="counter__label">${props.label}</span>
    <strong class="counter__value">${count}</strong>
    <button type="button" class="increment" onclick="${increment}">+${props.step}</button>
    <button type="button" class="reset" onclick="${reset}">reset</button>
  </div>`;
}

afterEach(() => {
  resetComponents();
});

describe('renderComponent', () => {
  it('mounts the component into a container and exposes the rendered view surface', () => {
    const rendered = renderComponent(Counter, { label: 'Hits', step: 2 });

    expect(rendered.container.contains(rendered.query('.counter'))).toBe(true);
    expect(rendered.text()).toContain('Hits');
    expect(rendered.html()).toContain('counter__value');
    expect(rendered.queryAll('button')).toHaveLength(2);
    expect(typeof rendered.click).toBe('function');
    expect(typeof rendered.input).toBe('function');
    expect(typeof rendered.submit).toBe('function');

    rendered.unmount();
  });

  it('renders the props it was given', () => {
    const rendered = renderComponent(Pill, { label: 'Open', tone: 'info' });

    expect(rendered.query('.pill')).toHaveText('Open');
    expect(rendered.query('.pill')?.classList.contains('pill--info')).toBe(true);

    rendered.unmount();
  });

  it('renders local state and updates it through an interaction', () => {
    const rendered = renderComponent(Counter, { label: 'Hits', step: 2 });
    expect(rendered.query('.counter__value')).toHaveText('0');

    rendered.click('.increment');
    flushEffects();
    expect(rendered.query('.counter__value')).toHaveText('2');

    rendered.click('.increment');
    rendered.click('.increment');
    flushEffects();
    expect(rendered.query('.counter__value')).toHaveText('6');

    rendered.click('.reset');
    flushEffects();
    expect(rendered.query('.counter__value')).toHaveText('0');

    rendered.unmount();
  });

  it('empties the container and stops the component effects on unmount', () => {
    const total = signal(1);
    let runs = 0;
    const Total = (): Fragment => {
      const doubled = computed(() => total.get() * 2);
      effect(() => {
        total.get();
        runs += 1;
      });
      return html`<p class="total">${doubled}</p>`;
    };

    const rendered = renderComponent(Total);
    expect(rendered.query('.total')).toHaveText('2');
    expect(runs).toBe(1);

    total.set(3);
    flushEffects();
    expect(rendered.query('.total')).toHaveText('6');
    expect(runs).toBe(2);

    rendered.unmount();
    expect(rendered.query('.total')).toBeNull();
    expect(rendered.container.childNodes).toHaveLength(0);

    expect(() => {
      total.set(4);
      flushEffects();
    }).not.toThrow();
    expect(runs).toBe(2);
  });

  it('runs onCleanup callbacks registered in the component on unmount', () => {
    const cleaned: string[] = [];
    const Timer = (): Fragment => {
      onCleanup(() => {
        cleaned.push('interval');
      });
      onCleanup(() => {
        cleaned.push('listener');
      });
      return html`<div class="timer">tick</div>`;
    };

    const rendered = renderComponent(Timer);
    expect(cleaned).toEqual([]);

    rendered.unmount();
    expect(cleaned).toEqual(['listener', 'interval']);
  });

  it('is idempotent on a second unmount', () => {
    const cleaned: string[] = [];
    const Widget = (): Fragment => {
      onCleanup(() => {
        cleaned.push('once');
      });
      return html`<div>w</div>`;
    };

    const rendered = renderComponent(Widget);
    rendered.unmount();
    rendered.unmount();

    expect(cleaned).toEqual(['once']);
  });

  it('fires a ref callback with an element that is connected and inside the container', () => {
    const seen: { el: Element | null; connected: boolean } = { el: null, connected: false };
    const Field = (): Fragment =>
      html`<input class="field" ref="${(el: Element) => {
        seen.el = el;
        seen.connected = el.isConnected;
      }}" />`;

    const rendered = renderComponent(Field);

    expect(seen.el).not.toBeNull();
    expect(seen.connected).toBe(true);
    expect(rendered.container.contains(seen.el)).toBe(true);
    expect(seen.el).toBe(rendered.query('.field'));

    rendered.unmount();
  });

  it('re-renders a keyed list after its signal changes', () => {
    interface Task {
      id: string;
      text: string;
    }

    const TaskList = (props: { tasks: readonly Task[] }): Fragment => {
      const tasks = signal(props.tasks);
      const rows = computed(() =>
        keyedMap(
          tasks.get(),
          (task) => task.id,
          (task) => html`<li class="task" data-id="${task.id}">${task.text}</li>`,
        ),
      );
      const drop = (): void => {
        tasks.update((current) => current.filter((task) => task.id !== 'b'));
      };
      return html`<div>
        <ul class="tasks">${rows}</ul>
        <button type="button" class="drop" onclick="${drop}">drop</button>
      </div>`;
    };

    const rendered = renderComponent(TaskList, {
      tasks: [
        { id: 'a', text: 'Write' },
        { id: 'b', text: 'Review' },
        { id: 'c', text: 'Ship' },
      ],
    });
    expect(rendered.queryAll('.task').map((el) => el.textContent)).toEqual(['Write', 'Review', 'Ship']);

    rendered.click('.drop');
    flushEffects();

    expect(rendered.queryAll('.task').map((el) => el.textContent)).toEqual(['Write', 'Ship']);
    expect(rendered.query('[data-id="b"]')).toBeNull();

    rendered.unmount();
  });

  it('throws when a selector matches nothing, naming the selector', () => {
    const rendered = renderComponent(Pill, { label: 'Open', tone: 'info' });
    expect(() => {
      rendered.click('.missing');
    }).toThrow(/\[TypeMVC\].*\.missing/u);
    rendered.unmount();
  });
});

// ---------------------------------------------------------------------------
// Nested component tags: a template's <Pill /> compiles to _callComponent('Pill')
// ---------------------------------------------------------------------------

interface BookCardProps {
  title: string;
  tags: readonly string[];
}

function BookCard(props: BookCardProps): Fragment {
  return html`<article class="book-card">
    <h2>${props.title}</h2>
    <ul class="tags">
      ${props.tags.map((tag) => _callComponent('Pill', { label: tag, tone: 'muted' }))}
    </ul>
  </article>`;
}

describe('registerComponents and resetComponents', () => {
  it('makes a nested component tag render', () => {
    registerComponents({ Pill });

    const rendered = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });

    expect(rendered.query('h2')).toHaveText('Dune');
    expect(rendered.queryAll('.pill')).toHaveLength(1);
    expect(rendered.query('.pill')).toHaveText('sci-fi');

    rendered.unmount();
  });

  it('warns and renders nothing for a component that was never registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const rendered = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });

    expect(rendered.queryAll('.pill')).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Pill" is not registered'));

    warn.mockRestore();
    rendered.unmount();
  });

  it('merges successive registrations and clears them all on reset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registerComponents({ Pill });
    registerComponents({ Counter });

    const card = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });
    expect(card.queryAll('.pill')).toHaveLength(1);
    card.unmount();

    const counter = renderComponent(Counter, { label: 'Hits', step: 1 });
    expect(counter.queryAll('.counter')).toHaveLength(1);
    counter.unmount();

    resetComponents();

    const after = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });
    expect(after.queryAll('.pill')).toHaveLength(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    after.unmount();
  });

  it('scopes a per-render registration and restores the previous registry on unmount', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const scoped = renderComponent(
      BookCard,
      { title: 'Dune', tags: ['sci-fi'] },
      { components: { Pill } },
    );
    expect(scoped.queryAll('.pill')).toHaveLength(1);

    scoped.unmount();

    const after = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });
    expect(after.queryAll('.pill')).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Pill" is not registered'));

    warn.mockRestore();
    after.unmount();
  });

  it('restores a file level registration after a per-render one is unmounted', () => {
    registerComponents({ Pill });

    const scoped = renderComponent(
      BookCard,
      { title: 'Dune', tags: ['sci-fi'] },
      { components: { Counter } },
    );
    expect(scoped.queryAll('.pill')).toHaveLength(1);
    scoped.unmount();

    const after = renderComponent(BookCard, { title: 'Dune', tags: ['sci-fi'] });
    expect(after.queryAll('.pill')).toHaveLength(1);
    after.unmount();
  });
});
