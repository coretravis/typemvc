// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Controller } from '../../src/core/controller.js';
import {
  controller,
  retain,
  get,
  layout,
  getClassLayout,
  getMethodLayout,
} from '../../src/core/decorators.js';
import { defineLayout, resolveLayoutChain, applyLayoutChain } from '../../src/layout/layout.js';
import { html } from '../../src/renderer/html.js';
import { Fragment } from '../../src/renderer/fragment.js';
import { assembleContext } from '../../src/core/context.js';
import type { LayoutConstructor, IRouter, ActionErrorTarget, ViewContext } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRouter(): IRouter {
  return {
    navigateTo: () => { return; },
    replace: () => { return; },
    back: () => { return; },
    forward: () => { return; },
    current: '/',
  };
}

function makeErrors(): ActionErrorTarget {
  return { action: null };
}

function makeContext(): ViewContext {
  return assembleContext(null, null, makeErrors(), makeRouter(), {}, new URLSearchParams(), {});
}

function fragmentText(frag: Fragment): string {
  return frag.nodes.map((n) => (n as Element).textContent).join('');
}

function fragmentHtml(frag: Fragment): string {
  return frag.nodes
    .map((n) => {
      if (n instanceof Element) return n.outerHTML;
      if (n.nodeType === Node.TEXT_NODE) return (n as Text).data;
      return '';
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Acceptance criterion 1: @layout stores metadata
// ---------------------------------------------------------------------------

describe('@layout decorator metadata storage', () => {
  /* eslint-disable @typescript-eslint/no-extraneous-class -- test fixture layout classes */
  class LayoutA {}
  class LayoutB {}
  /* eslint-enable @typescript-eslint/no-extraneous-class */

  const LayoutACtor = LayoutA as unknown as LayoutConstructor;
  const LayoutBCtor = LayoutB as unknown as LayoutConstructor;

  it('stores class-level @layout in controller metadata', () => {
    @controller('/test-layout-class')
    @layout(LayoutACtor)
    class TestCtrl extends Controller {}

    const cls = TestCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassLayout(cls)).toBe(LayoutACtor);
  });

  it('stores method-level @layout in method metadata', () => {
    class TestCtrl2 extends Controller {
      @layout(LayoutBCtor)
      @get('print')
      print(): unknown { return null; }
    }

    const proto = TestCtrl2.prototype as object;
    expect(getMethodLayout(proto, 'print')).toBe(LayoutBCtor);
  });

  it('method-level @layout does not affect class-level metadata', () => {
    class TestCtrl3 extends Controller {
      @layout(LayoutBCtor)
      @get()
      index(): unknown { return null; }
    }

    const cls = TestCtrl3 as unknown as new (...args: unknown[]) => unknown;
    expect(getClassLayout(cls)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: action-level @layout takes precedence
// ---------------------------------------------------------------------------

describe('action-level @layout precedence over controller-level', () => {
  const OuterLayout = defineLayout({
    template: (ctx) => html`<div class="outer">${ctx.slot}</div>`,
  });

  const ActionLayout = defineLayout({
    template: (ctx) => html`<div class="action">${ctx.slot}</div>`,
  });

  @controller('/precedence-test')
  @layout(OuterLayout)
  class PrecedenceCtrl extends Controller {
    @layout(ActionLayout)
    @get('special')
    special(): unknown { return null; }

    @get()
    index(): unknown { return null; }
  }

  const cls = PrecedenceCtrl as unknown as new (...args: unknown[]) => unknown;

  it('resolveLayoutChain uses action-level layout for the decorated action', () => {
    const chain = resolveLayoutChain(cls, 'special');
    expect(chain[0]).toBe(ActionLayout);
  });

  it('resolveLayoutChain uses class-level layout for undecorated actions', () => {
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain[0]).toBe(OuterLayout);
  });

  it('action-level layout produces different wrapping than controller-level', () => {
    const page = html`<p>content</p>`;
    const ctx = makeContext();

    const specialChain = resolveLayoutChain(cls, 'special');
    const specialResult = applyLayoutChain(specialChain, page, ctx);
    expect(fragmentHtml(specialResult)).toContain('class="action"');
    expect(fragmentHtml(specialResult)).not.toContain('class="outer"');
  });
});

// ---------------------------------------------------------------------------
// defineLayout
// ---------------------------------------------------------------------------

describe('defineLayout', () => {
  it('returns a function (layout constructor)', () => {
    const L = defineLayout({ template: (ctx) => html`${ctx.slot}` });
    expect(typeof L).toBe('function');
  });

  it('returned constructor is usable with @layout decorator', () => {
    const L = defineLayout({ template: (ctx) => html`${ctx.slot}` });
    expect(() => {
      @controller('/definetest')
      @layout(L)
      class TestCtrl extends Controller {}
      void TestCtrl;
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveLayoutChain
// ---------------------------------------------------------------------------

describe('resolveLayoutChain', () => {
  it('returns empty array when no layout is declared', () => {
    @controller('/no-layout-chain')
    class NoLayoutCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = NoLayoutCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(resolveLayoutChain(cls, 'index')).toHaveLength(0);
  });

  it('returns a single-element array for class-level layout', () => {
    const L = defineLayout({ template: (ctx) => html`${ctx.slot}` });

    @controller('/single-class-layout')
    @layout(L)
    class SingleLayoutCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = SingleLayoutCtrl as unknown as new (...args: unknown[]) => unknown;
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(L);
  });

  it('returns a single-element array for method-level layout', () => {
    const L = defineLayout({ template: (ctx) => html`${ctx.slot}` });

    class MethodLayoutCtrl extends Controller {
      @layout(L)
      @get()
      index(): unknown { return null; }
    }

    const cls = MethodLayoutCtrl as unknown as new (...args: unknown[]) => unknown;
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(L);
  });

  it('returns [inner, outer] for a two-level nested layout chain', () => {
    const Outer = defineLayout({ template: (ctx) => html`<outer>${ctx.slot}</outer>` });
    const Inner = defineLayout({
      parent: Outer,
      template: (ctx) => html`<inner>${ctx.slot}</inner>`,
    });

    @controller('/nested-chain')
    @layout(Inner)
    class NestedCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = NestedCtrl as unknown as new (...args: unknown[]) => unknown;
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe(Inner);
    expect(chain[1]).toBe(Outer);
  });

  it('resolveLayoutChain does not throw for a valid linear chain', () => {
    const A = defineLayout({ template: (ctx) => html`<a>${ctx.slot}</a>` });
    const B = defineLayout({ parent: A, template: (ctx) => html`<b>${ctx.slot}</b>` });

    @controller('/no-cycle')
    @layout(B)
    class NoCycleCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }
    const cls = NoCycleCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(() => resolveLayoutChain(cls, 'index')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3 + 4: context.slot is a Fragment containing page output
// ---------------------------------------------------------------------------

describe('applyLayoutChain: context.slot is the rendered page Fragment', () => {
  it('layout template receives context.slot as a Fragment instance', () => {
    let receivedSlot: unknown = undefined;

    const CapturingLayout = defineLayout({
      template: (ctx) => {
        receivedSlot = ctx.slot;
        return html`<wrapper>${ctx.slot}</wrapper>`;
      },
    });

    const page = html`<p>hello</p>`;
    const ctx = makeContext();
    applyLayoutChain([CapturingLayout], page, ctx);

    expect(receivedSlot).toBeInstanceOf(Fragment);
  });

  it('context.slot is the same Fragment instance as the page view', () => {
    let capturedSlot: Fragment | undefined;

    const CapturingLayout2 = defineLayout({
      template: (ctx) => {
        capturedSlot = ctx.slot;
        return html`<div>${ctx.slot}</div>`;
      },
    });

    const page = html`<span>page content</span>`;
    const ctx = makeContext();
    applyLayoutChain([CapturingLayout2], page, ctx);

    expect(capturedSlot).toBe(page);
  });

  it('context.slot contains the rendered output of the page view', () => {
    const page = html`<article>page content</article>`;
    let slotText = '';

    const InspectingLayout = defineLayout({
      template: (ctx) => {
        slotText = fragmentText(ctx.slot);
        return html`<main>${ctx.slot}</main>`;
      },
    });

    const ctx = makeContext();
    applyLayoutChain([InspectingLayout], page, ctx);

    expect(slotText).toContain('page content');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 5: layout renders its own markup around context.slot
// ---------------------------------------------------------------------------

describe('applyLayoutChain: layout renders markup around context.slot', () => {
  it('single layout wraps slot with its own markup', () => {
    const WrapperLayout = defineLayout({
      template: (ctx) => html`<header>nav</header><main>${ctx.slot}</main><footer>foot</footer>`,
    });

    const page = html`<p>page</p>`;
    const ctx = makeContext();
    const result = applyLayoutChain([WrapperLayout], page, ctx);
    const output = fragmentHtml(result);

    expect(output).toContain('<header>nav</header>');
    expect(output).toContain('<main>');
    expect(output).toContain('<p>page</p>');
    expect(output).toContain('<footer>foot</footer>');
  });

  it('layout markup appears before and after the slot content', () => {
    const SandwichLayout = defineLayout({
      template: (ctx) => html`<before>A</before>${ctx.slot}<after>B</after>`,
    });

    const page = html`<em>middle</em>`;
    const ctx = makeContext();
    const result = applyLayoutChain([SandwichLayout], page, ctx);
    const output = fragmentHtml(result);

    const beforePos = output.indexOf('<before>A</before>');
    const middlePos = output.indexOf('<em>middle</em>');
    const afterPos = output.indexOf('<after>B</after>');

    expect(beforePos).toBeGreaterThanOrEqual(0);
    expect(middlePos).toBeGreaterThan(beforePos);
    expect(afterPos).toBeGreaterThan(middlePos);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 6: two-level nested layout, inside-out rendering
// ---------------------------------------------------------------------------

describe('nested layouts: two-level chain renders inside-out', () => {
  const OuterLayout2 = defineLayout({
    template: (ctx) => html`<outer>${ctx.slot}</outer>`,
  });

  const InnerLayout2 = defineLayout({
    parent: OuterLayout2,
    template: (ctx) => html`<inner>${ctx.slot}</inner>`,
  });

  it('two-level chain produces outer(inner(page)) structure', () => {
    @controller('/two-level')
    @layout(InnerLayout2)
    @retain()
    class TwoLevelCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = TwoLevelCtrl as unknown as new (...args: unknown[]) => unknown;
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain).toHaveLength(2);

    const page = html`<p>content</p>`;
    const ctx = makeContext();
    const result = applyLayoutChain(chain, page, ctx);
    const output = fragmentHtml(result);

    // Outer wraps inner which wraps the page
    expect(output).toContain('<outer>');
    expect(output).toContain('<inner>');
    expect(output).toContain('<p>content</p>');
    expect(output).toMatch(/<outer>.*<inner>.*<p>content<\/p>.*<\/inner>.*<\/outer>/s);
  });

  it('inner layout slot contains page content; outer layout slot contains inner output', () => {
    const innerSlots: string[] = [];
    const outerSlots: string[] = [];

    const TrackOuter = defineLayout({
      template: (ctx) => {
        outerSlots.push(fragmentHtml(ctx.slot));
        return html`<outer>${ctx.slot}</outer>`;
      },
    });

    const TrackInner = defineLayout({
      parent: TrackOuter,
      template: (ctx) => {
        innerSlots.push(fragmentHtml(ctx.slot));
        return html`<inner>${ctx.slot}</inner>`;
      },
    });

    const page = html`<p>the page</p>`;
    const ctx = makeContext();

    @controller('/track-two-level')
    @layout(TrackInner)
    class TrackCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const trackCls = TrackCtrl as unknown as new (...args: unknown[]) => unknown;
    const chain = resolveLayoutChain(trackCls, 'index');
    applyLayoutChain(chain, page, ctx);

    expect(innerSlots[0]).toContain('<p>the page</p>');
    expect(outerSlots[0]).toContain('<inner>');
    expect(outerSlots[0]).toContain('<p>the page</p>');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 7: no layout renders without any wrapper
// ---------------------------------------------------------------------------

describe('no layout declared: page fragment passes through unchanged', () => {
  it('applyLayoutChain with empty chain returns the slot unchanged', () => {
    const page = html`<p>plain page</p>`;
    const ctx = makeContext();
    const result = applyLayoutChain([], page, ctx);
    expect(result).toBe(page);
  });

  it('controller with no @layout: resolveLayoutChain returns empty array', () => {
    @controller('/bare')
    class BareCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = BareCtrl as unknown as new (...args: unknown[]) => unknown;
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain).toHaveLength(0);
  });

  it('no-layout pipeline produces the unmodified page fragment', () => {
    @controller('/bare2')
    class BareCtrl2 extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = BareCtrl2 as unknown as new (...args: unknown[]) => unknown;
    const page = html`<section>bare page</section>`;
    const ctx = makeContext();
    const chain = resolveLayoutChain(cls, 'index');
    const result = applyLayoutChain(chain, page, ctx);
    expect(result).toBe(page);
    expect(fragmentHtml(result)).toContain('<section>bare page</section>');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 8: final Fragment is the fully resolved layout chain output
// ---------------------------------------------------------------------------

describe('final mounted Fragment is the resolved layout chain output', () => {
  it('single layout: final fragment contains layout markup and page content', () => {
    const FinalLayout = defineLayout({
      template: (ctx) => html`<div class="shell">${ctx.slot}</div>`,
    });

    @controller('/final-single')
    @layout(FinalLayout)
    class FinalSingleCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = FinalSingleCtrl as unknown as new (...args: unknown[]) => unknown;
    const page = html`<p>page</p>`;
    const ctx = makeContext();
    const chain = resolveLayoutChain(cls, 'index');
    const result = applyLayoutChain(chain, page, ctx);

    const output = fragmentHtml(result);
    expect(output).toContain('class="shell"');
    expect(output).toContain('<p>page</p>');
  });

  it('two-level layout: final fragment contains both layout wrappers and page content', () => {
    const Shell = defineLayout({
      template: (ctx) => html`<html-shell>${ctx.slot}</html-shell>`,
    });

    const Section = defineLayout({
      parent: Shell,
      template: (ctx) => html`<html-section>${ctx.slot}</html-section>`,
    });

    @controller('/final-two-level')
    @layout(Section)
    class FinalTwoLevelCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = FinalTwoLevelCtrl as unknown as new (...args: unknown[]) => unknown;
    const page = html`<article>content</article>`;
    const ctx = makeContext();
    const chain = resolveLayoutChain(cls, 'index');
    const result = applyLayoutChain(chain, page, ctx);

    const output = fragmentHtml(result);
    expect(output).toContain('<html-shell>');
    expect(output).toContain('<html-section>');
    expect(output).toContain('<article>content</article>');
  });

  it('layout Fragment contains correct node tree that could be mounted into an outlet', () => {
    const MountableLayout = defineLayout({
      template: (ctx) => html`<div id="root">${ctx.slot}</div>`,
    });

    @controller('/mountable')
    @layout(MountableLayout)
    class MountableCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }

    const cls = MountableCtrl as unknown as new (...args: unknown[]) => unknown;
    const page = html`<span>mountable</span>`;
    const ctx = makeContext();
    const chain = resolveLayoutChain(cls, 'index');
    const result = applyLayoutChain(chain, page, ctx);

    // The result is a Fragment that can be mounted into an outlet
    expect(result).toBeInstanceOf(Fragment);
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 9: action-level @layout overrides controller-level
// ---------------------------------------------------------------------------

describe('action-level @layout overrides controller-level layout', () => {
  const ControllerLayout = defineLayout({
    template: (ctx) => html`<ctrl-layout>${ctx.slot}</ctrl-layout>`,
  });

  const ActionOverrideLayout = defineLayout({
    template: (ctx) => html`<action-layout>${ctx.slot}</action-layout>`,
  });

  @controller('/override-test')
  @layout(ControllerLayout)
  class OverrideCtrl extends Controller {
    @layout(ActionOverrideLayout)
    @get('special')
    special(): unknown { return null; }

    @get()
    index(): unknown { return null; }
  }

  const cls = OverrideCtrl as unknown as new (...args: unknown[]) => unknown;

  it('resolveLayoutChain for the overriding action uses action-level layout', () => {
    const chain = resolveLayoutChain(cls, 'special');
    expect(chain[0]).toBe(ActionOverrideLayout);
    expect(chain[0]).not.toBe(ControllerLayout);
  });

  it('resolveLayoutChain for a non-overriding action uses controller-level layout', () => {
    const chain = resolveLayoutChain(cls, 'index');
    expect(chain[0]).toBe(ControllerLayout);
  });

  it('overriding action produces action-level layout markup, not controller-level', () => {
    const page = html`<p>page</p>`;
    const ctx = makeContext();

    const chain = resolveLayoutChain(cls, 'special');
    const result = applyLayoutChain(chain, page, ctx);
    const output = fragmentHtml(result);

    expect(output).toContain('<action-layout>');
    expect(output).not.toContain('<ctrl-layout>');
  });

  it('non-overriding action produces controller-level layout markup', () => {
    const page = html`<p>page</p>`;
    const ctx = makeContext();

    const chain = resolveLayoutChain(cls, 'index');
    const result = applyLayoutChain(chain, page, ctx);
    const output = fragmentHtml(result);

    expect(output).toContain('<ctrl-layout>');
    expect(output).not.toContain('<action-layout>');
  });
});

// ---------------------------------------------------------------------------
// Error handling: applyLayoutChain with non-defineLayout constructor
// ---------------------------------------------------------------------------

describe('applyLayoutChain error handling', () => {
  it('throws with [TypeMVC] prefix when passed a layout not created by defineLayout()', () => {
    /* eslint-disable @typescript-eslint/no-extraneous-class -- test fixture */
    class RawLayout {}
    /* eslint-enable @typescript-eslint/no-extraneous-class */
    const rawCtor = RawLayout as unknown as LayoutConstructor;

    const page = html`<p>page</p>`;
    const ctx = makeContext();
    expect(() => applyLayoutChain([rawCtor], page, ctx)).toThrow('[TypeMVC]');
  });

  it('throws mentioning defineLayout in the error message', () => {
    /* eslint-disable @typescript-eslint/no-extraneous-class -- test fixture */
    class RawLayout2 {}
    /* eslint-enable @typescript-eslint/no-extraneous-class */
    const rawCtor = RawLayout2 as unknown as LayoutConstructor;

    const page = html`<p>page</p>`;
    const ctx = makeContext();
    expect(() => applyLayoutChain([rawCtor], page, ctx)).toThrow('defineLayout');
  });
});

// ---------------------------------------------------------------------------
// Layout context: base context properties are accessible inside layout template
// ---------------------------------------------------------------------------

describe('layout context: base context properties accessible in template', () => {
  it('layout template can access context.router', () => {
    let routerSeen: unknown;

    const RouterInspectLayout = defineLayout({
      template: (ctx) => {
        routerSeen = ctx.router;
        return html`${ctx.slot}`;
      },
    });

    const router = makeRouter();
    const context = assembleContext(null, null, makeErrors(), router, {}, new URLSearchParams(), {});
    const page = html`<p>x</p>`;
    applyLayoutChain([RouterInspectLayout], page, context);

    expect(routerSeen).toBe(router);
  });

  it('layout template can access context.params', () => {
    let paramsSeen: unknown;

    const ParamsInspectLayout = defineLayout({
      template: (ctx) => {
        paramsSeen = ctx.params;
        return html`${ctx.slot}`;
      },
    });

    const params = { id: '42' };
    const context = assembleContext(null, null, makeErrors(), makeRouter(), params, new URLSearchParams(), {});
    const page = html`<p>x</p>`;
    applyLayoutChain([ParamsInspectLayout], page, context);

    expect(paramsSeen).toEqual({ id: '42' });
  });
});
