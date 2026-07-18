import { describe, it, expect } from 'vitest';
import { createControllerTest, createTestApp, createTestRouter } from '../../src/testing/index.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get } from '../../src/core/decorators.js';
import { inject } from '../../src/di/decorators.js';
import { ROUTER } from '../../src/router/tokens.js';
import { EmptyView } from '../../src/core/view.js';
import type { IRouter, IView } from '../../src/types/index.js';

const CLOCK = Symbol('Clock');

class Clock {
  readonly now = 'noon';
}

class ShellBase extends Controller {
  constructor(@inject(CLOCK) protected readonly clock: Clock) {
    super();
  }
}

@controller('/dashboard')
class DashboardController extends ShellBase {
  @get()
  index(): IView {
    this.data.set('now', this.clock.now);
    return EmptyView();
  }

  @get('leave')
  leave(): IView {
    this.router.navigateTo('/somewhere-else');
    return EmptyView();
  }
}

class PaletteService {
  constructor(@inject(ROUTER) private readonly router: IRouter) {}

  open(path: string): void {
    this.router.navigateTo(path);
  }
}

describe('createTestRouter', () => {
  it('records navigations instead of performing them', () => {
    const router = createTestRouter();

    router.navigateTo('/a');
    router.replace('/b');
    router.back();

    expect(router.calls).toEqual([
      { method: 'navigateTo', path: '/a' },
      { method: 'replace', path: '/b' },
      { method: 'back', path: null },
    ]);
  });
});

describe('createControllerTest', () => {
  it('injects a dependency declared on a base class the controller extends', async () => {
    const test = createControllerTest(DashboardController).mock(CLOCK, new Clock());

    const { viewBag } = await test.action((c) => c.index());

    expect(viewBag.now).toBe('noon');
  });

  it('gives the controller a router whose navigations are assertable', async () => {
    const test = createControllerTest(DashboardController).mock(CLOCK, new Clock());

    await test.action((c) => c.leave());

    expect(test.router.calls).toEqual([{ method: 'navigateTo', path: '/somewhere-else' }]);
  });

  it('resolves the ROUTER token for a service the controller depends on', () => {
    const test = createControllerTest(DashboardController).mock(CLOCK, new Clock());

    const palette = new PaletteService(test.container.resolve(ROUTER));
    palette.open('/palette-target');

    expect(test.router.calls).toEqual([{ method: 'navigateTo', path: '/palette-target' }]);
  });
});

describe('createTestApp', () => {
  it('resolves the ROUTER token during a navigation so a service can navigate', async () => {
    const app = createTestApp().route(DashboardController).mock(CLOCK, new Clock());

    const result = await app.navigate('/dashboard/leave');

    expect(result.action).toBe('leave');
    expect(result.redirectedTo).toBe('/somewhere-else');
  });
});
