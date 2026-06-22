import { describe, it, expect, beforeEach } from 'vitest';
import { Controller } from '../../src/core/controller.js';
import {
  controller,
  retain,
  get,
  post,
  put,
  patch,
  del,
  body,
  guard,
  layout,
  getControllerMeta,
  getRetentionMeta,
  getActionMeta,
  getAllActionMeta,
  getClassGuards,
  getMethodGuards,
  getClassLayout,
  getMethodLayout,
  getBodyMeta,
  routeRegistry,
  RESERVED_KEYS,
} from '../../src/core/decorators.js';
import { EmptyView } from '../../src/core/view.js';
import type { GuardConstructor, LayoutConstructor, IView } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// @body parameter decorator (issue 049)
// ---------------------------------------------------------------------------

describe('@body parameter decorator', () => {
  class SampleDto {
    name = '';
  }

  it('records the parameter index and DTO class, retrievable via getBodyMeta', () => {
    @controller('/sample')
    class SampleController extends Controller {
      @post('{id}')
      update(id: string, @body(SampleDto) dto: SampleDto): IView {
        void id;
        void dto;
        return EmptyView();
      }
    }

    const meta = getBodyMeta(SampleController.prototype, 'update');
    expect(meta).toEqual({ index: 1, dto: SampleDto });
  });

  it('returns undefined for an action with no @body parameter', () => {
    @controller('/plain')
    class PlainController extends Controller {
      @post()
      create(): IView {
        return EmptyView();
      }
    }

    expect(getBodyMeta(PlainController.prototype, 'create')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Controller base class
// ---------------------------------------------------------------------------

describe('Controller base class', () => {
  it('hasErrors() returns false when no errors have been added', () => {
    const ctrl = new Controller();
    expect(ctrl.hasErrors()).toBe(false);
  });

  it('hasErrors() returns true after addError()', () => {
    const ctrl = new Controller();
    ctrl.addError('name', 'Name is required');
    expect(ctrl.hasErrors()).toBe(true);
  });

  it('addError() for different fields both contribute to hasErrors()', () => {
    const ctrl = new Controller();
    ctrl.addError('name', 'required');
    ctrl.addError('email', 'invalid');
    expect(ctrl.hasErrors()).toBe(true);
  });

  it('addError() for the same field overwrites the previous message', () => {
    const ctrl = new Controller();
    ctrl.addError('name', 'too short');
    ctrl.addError('name', 'required');
    // hasErrors is still true
    expect(ctrl.hasErrors()).toBe(true);
  });

  it('hasErrors() reflects independent state per instance', () => {
    const a = new Controller();
    const b = new Controller();
    a.addError('field', 'err');
    expect(a.hasErrors()).toBe(true);
    expect(b.hasErrors()).toBe(false);
  });

  it('onActionError() can be overridden in a subclass', () => {
    let called = false;
    class MyController extends Controller {
      protected override onActionError(): void {
        called = true;
      }
    }
    const ctrl = new MyController();
    // Calling the protected method via an unsafe cast to test override
    (ctrl as unknown as { onActionError: (e: Error, m: string) => void }).onActionError(
      new Error('oops'),
      'myMethod',
    );
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @controller
// ---------------------------------------------------------------------------

describe('@controller decorator', () => {
  it('stores the base path in controller metadata', () => {
    @controller('/articles')
    class ArticlesCtrl extends Controller {}

    expect(getControllerMeta(ArticlesCtrl as unknown as new (...args: unknown[]) => unknown)?.basePath).toBe('/articles');
  });

  it('registers the class in the route registry', () => {
    @controller('/pages')
    class PagesCtrl extends Controller {}

    expect(routeRegistry.has(PagesCtrl as unknown as new (...args: unknown[]) => unknown)).toBe(true);
  });

  it('stores root path "/" correctly', () => {
    @controller('/')
    class HomeCtrl extends Controller {}

    expect(getControllerMeta(HomeCtrl as unknown as new (...args: unknown[]) => unknown)?.basePath).toBe('/');
  });

  it('throws with [TypeMVC] prefix when a non-route method name collides with a reserved key', () => {
    expect(() => {
      @controller('/bad')
      class BadCtrl extends Controller {
        model(): string { return ''; }
      }
      void BadCtrl;
    }).toThrow('[TypeMVC]');
  });

  it('throws mentioning the colliding method name', () => {
    expect(() => {
      @controller('/bad2')
      class BadCtrl2 extends Controller {
        errors(): string[] { return []; }
      }
      void BadCtrl2;
    }).toThrow('errors');
  });

  it('does NOT throw when a route method shares a reserved key name', () => {
    expect(() => {
      @controller('/ok')
      class OkCtrl extends Controller {
        @get()
        model(): unknown { return null; }
      }
      void OkCtrl;
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RESERVED_KEYS constant
// ---------------------------------------------------------------------------

describe('RESERVED_KEYS', () => {
  it('contains all seven reserved context keys', () => {
    expect(RESERVED_KEYS.has('data')).toBe(true);
    expect(RESERVED_KEYS.has('errors')).toBe(true);
    expect(RESERVED_KEYS.has('router')).toBe(true);
    expect(RESERVED_KEYS.has('params')).toBe(true);
    expect(RESERVED_KEYS.has('query')).toBe(true);
    expect(RESERVED_KEYS.has('auth')).toBe(true);
    expect(RESERVED_KEYS.has('model')).toBe(true);
  });

  const reservedKeys = ['data', 'errors', 'router', 'params', 'query', 'auth', 'model'];
  for (const key of reservedKeys) {
    it(`throws on non-route method named "${key}"`, () => {
      expect(() => {
        const methods: Record<string, () => void> = {};
        methods[key] = function (): void { return; };

        class DynCtrl extends Controller {}

        Object.defineProperty(DynCtrl.prototype, key, {
          value: methods[key],
          writable: true,
          configurable: true,
          enumerable: false,
        });

        controller(`/${key}`)(DynCtrl);
      }).toThrow('[TypeMVC]');
    });
  }
});

// ---------------------------------------------------------------------------
// @retain decorator
// ---------------------------------------------------------------------------

describe('@retain decorator', () => {
  it('@retain() stores retention meta with ttlMs undefined (indefinite)', () => {
    @controller('/chat')
    @retain()
    class ChatCtrl extends Controller {}
    const meta = getRetentionMeta(ChatCtrl);
    expect(meta).toBeDefined();
    expect(meta?.ttlMs).toBeUndefined();
  });

  it('@retain(ttlMs) stores retention meta with the given TTL', () => {
    @controller('/users')
    @retain(300_000)
    class UsersCtrl extends Controller {}
    const meta = getRetentionMeta(UsersCtrl);
    expect(meta?.ttlMs).toBe(300_000);
  });

  it('getRetentionMeta returns undefined for a class with no @retain decorator', () => {
    @controller('/about')
    class AboutCtrl extends Controller {}
    expect(getRetentionMeta(AboutCtrl as unknown as new (...args: unknown[]) => unknown)).toBeUndefined();
  });

  it('@retain(-1) throws with [TypeMVC] prefix in DEV', () => {
    expect(() => {
      @controller('/bad-ttl')
      @retain(-1)
      class BadCtrl extends Controller {}
      void BadCtrl;
    }).toThrow('[TypeMVC]');
  });

  it('@retain(0) throws with [TypeMVC] prefix in DEV', () => {
    expect(() => {
      @controller('/zero-ttl')
      @retain(0)
      class ZeroCtrl extends Controller {}
      void ZeroCtrl;
    }).toThrow('[TypeMVC]');
  });
});

// ---------------------------------------------------------------------------
// Controller lifecycle hooks
// ---------------------------------------------------------------------------

describe('Controller lifecycle hooks', () => {
  it('onCleanup callbacks are called during _dispose in reverse order', async () => {
    const order: number[] = [];
    const ctrl = new Controller();
    // eslint-disable-next-line @typescript-eslint/dot-notation -- accessing protected method in test
    ctrl['onCleanup'](() => { order.push(1); });
    // eslint-disable-next-line @typescript-eslint/dot-notation -- accessing protected method in test
    ctrl['onCleanup'](() => { order.push(2); });
    // eslint-disable-next-line @typescript-eslint/dot-notation -- accessing protected method in test
    ctrl['onCleanup'](() => { order.push(3); });
    await ctrl._dispose('navigation');
    expect(order).toEqual([3, 2, 1]);
  });

  it('_dispose calls onDispose before cleanup callbacks', async () => {
    const order: string[] = [];
    class TrackingCtrl extends Controller {
      protected override onDispose(): void { order.push('onDispose'); }
    }
    const ctrl = new TrackingCtrl();
    // eslint-disable-next-line @typescript-eslint/dot-notation -- accessing protected method in test
    ctrl['onCleanup'](() => { order.push('cleanup'); });
    await ctrl._dispose('navigation');
    expect(order).toEqual(['onDispose', 'cleanup']);
  });

  it('_dispose passes the DisposeReason to onDispose', async () => {
    let receivedReason: string | undefined;
    class ReasonCtrl extends Controller {
      protected override onDispose(reason: import('../../src/types/index.js').DisposeReason): void {
        receivedReason = reason;
      }
    }
    const ctrl = new ReasonCtrl();
    await ctrl._dispose('ttl-expired');
    expect(receivedReason).toBe('ttl-expired');
  });

  it('_dispose is safe to call with no registered cleanups', async () => {
    const ctrl = new Controller();
    await expect(ctrl._dispose('navigation')).resolves.toBeUndefined();
  });

  it('_dispose reports errors to onError without halting remaining callbacks', async () => {
    const errors: string[] = [];
    const ran: string[] = [];
    const ctrl = new Controller();
    // eslint-disable-next-line @typescript-eslint/dot-notation -- accessing protected method in test
    ctrl['onCleanup'](() => { ran.push('first'); throw new Error('first-fail'); });
    // eslint-disable-next-line @typescript-eslint/dot-notation -- accessing protected method in test
    ctrl['onCleanup'](() => { ran.push('second'); });
    await ctrl._dispose('navigation', (err) => { errors.push(err.message); });
    expect(ran).toContain('first');
    expect(ran).toContain('second');
    expect(errors).toContain('first-fail');
  });

  it('_runInit calls onInit exactly once (idempotent)', async () => {
    let count = 0;
    class CountingCtrl extends Controller {
      protected override onInit(): void { count++; }
    }
    const ctrl = new CountingCtrl();
    await ctrl._runInit();
    await ctrl._runInit();
    expect(count).toBe(1);
  });

  it('_activate calls onActivate with the route', async () => {
    let received: import('../../src/types/index.js').ResolvedRoute | undefined;
    class ActivatingCtrl extends Controller {
      protected override onActivate(route: import('../../src/types/index.js').ResolvedRoute): void {
        received = route;
      }
    }
    const ctrl = new ActivatingCtrl();
    const route = { pathname: '/test', params: {}, query: new URLSearchParams() };
    await ctrl._activate(route);
    expect(received?.pathname).toBe('/test');
  });

  it('_deactivate calls onDeactivate with the route', async () => {
    let received: import('../../src/types/index.js').ResolvedRoute | undefined;
    class DeactivatingCtrl extends Controller {
      protected override onDeactivate(route: import('../../src/types/index.js').ResolvedRoute): void {
        received = route;
      }
    }
    const ctrl = new DeactivatingCtrl();
    const route = { pathname: '/leaving', params: {}, query: new URLSearchParams() };
    await ctrl._deactivate(route);
    expect(received?.pathname).toBe('/leaving');
  });
});

// ---------------------------------------------------------------------------
// Verb decorators
// ---------------------------------------------------------------------------

describe('Verb decorators', () => {
  class VerbProto extends Controller {
    @get()
    index(): unknown { return null; }

    @get('{id}')
    show(): unknown { return null; }

    @post()
    create(): unknown { return null; }

    @post('{id}')
    update(): unknown { return null; }

    @put('{id}')
    replace(): unknown { return null; }

    @patch('{id}')
    partialUpdate(): unknown { return null; }

    @del('{id}')
    remove(): unknown { return null; }
  }

  const proto = VerbProto.prototype as object;

  it('@get() stores verb GET with empty segment', () => {
    expect(getActionMeta(proto, 'index')).toEqual({ verb: 'GET', segment: '' });
  });

  it('@get("{id}") stores verb GET with segment "{id}"', () => {
    expect(getActionMeta(proto, 'show')).toEqual({ verb: 'GET', segment: '{id}' });
  });

  it('@post() stores verb POST with empty segment', () => {
    expect(getActionMeta(proto, 'create')).toEqual({ verb: 'POST', segment: '' });
  });

  it('@post("{id}") stores verb POST with segment', () => {
    expect(getActionMeta(proto, 'update')).toEqual({ verb: 'POST', segment: '{id}' });
  });

  it('@put("{id}") stores verb PUT with segment', () => {
    expect(getActionMeta(proto, 'replace')).toEqual({ verb: 'PUT', segment: '{id}' });
  });

  it('@patch("{id}") stores verb PATCH with segment', () => {
    expect(getActionMeta(proto, 'partialUpdate')).toEqual({ verb: 'PATCH', segment: '{id}' });
  });

  it('@del("{id}") stores verb DELETE with segment', () => {
    expect(getActionMeta(proto, 'remove')).toEqual({ verb: 'DELETE', segment: '{id}' });
  });

  it('getAllActionMeta returns all decorated methods', () => {
    const all = getAllActionMeta(proto);
    expect(all.has('index')).toBe(true);
    expect(all.has('show')).toBe(true);
    expect(all.has('create')).toBe(true);
    expect(all.has('remove')).toBe(true);
  });

  it('getActionMeta returns undefined for undecorated method', () => {
    expect(getActionMeta(proto, 'nonExistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// @guard decorator
// ---------------------------------------------------------------------------

describe('@guard decorator', () => {
  class AuthGuard { canActivate(): boolean { return true; } }
  class OwnerGuard { canActivate(): boolean { return true; } }

  const AuthGuardCtor = AuthGuard as unknown as GuardConstructor;
  const OwnerGuardCtor = OwnerGuard as unknown as GuardConstructor;

  it('@guard on a class stores the guard class in class guard metadata', () => {
    @controller('/guarded')
    @guard(AuthGuardCtor)
    class GuardedCtrl extends Controller {}

    const cls = GuardedCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassGuards(cls)).toContain(AuthGuardCtor);
  });

  it('multiple @guard decorators on a class accumulate in order', () => {
    @controller('/multi-guarded')
    @guard(OwnerGuardCtor)
    @guard(AuthGuardCtor)
    class MultiGuardedCtrl extends Controller {}

    const cls = MultiGuardedCtrl as unknown as new (...args: unknown[]) => unknown;
    const guards = getClassGuards(cls);
    expect(guards[0]).toBe(OwnerGuardCtor);
    expect(guards[1]).toBe(AuthGuardCtor);
  });

  it('@guard on a method stores the guard class in method guard metadata', () => {
    class MethodGuardCtrl extends Controller {
      @guard(AuthGuardCtor)
      @get('{id}')
      details(): unknown { return null; }
    }

    const proto = MethodGuardCtrl.prototype as object;
    expect(getMethodGuards(proto, 'details')).toContain(AuthGuardCtor);
  });

  it('@guard on method does not affect class guard metadata', () => {
    class MethodOnlyGuardCtrl extends Controller {
      @guard(AuthGuardCtor)
      @get()
      index(): unknown { return null; }
    }

    const cls = MethodOnlyGuardCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassGuards(cls)).not.toContain(AuthGuardCtor);
  });

  it('getClassGuards returns empty array for class with no guard decorator', () => {
    @controller('/no-guard')
    class NoGuardCtrl extends Controller {}

    const cls = NoGuardCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassGuards(cls)).toHaveLength(0);
  });

  it('getMethodGuards returns empty array for undecorated method', () => {
    class AnyCtrl extends Controller {
      @get()
      index(): unknown { return null; }
    }
    const proto = AnyCtrl.prototype as object;
    expect(getMethodGuards(proto, 'index')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// @layout decorator
// ---------------------------------------------------------------------------

describe('@layout decorator', () => {
  /* eslint-disable @typescript-eslint/no-extraneous-class -- test fixture layout classes */
  class MainLayout {}
  class PrintLayout {}
  /* eslint-enable @typescript-eslint/no-extraneous-class */

  const MainLayoutCtor = MainLayout as unknown as LayoutConstructor;
  const PrintLayoutCtor = PrintLayout as unknown as LayoutConstructor;

  it('@layout on a class stores the layout class in class layout metadata', () => {
    @controller('/laid-out')
    @layout(MainLayoutCtor)
    class LaidOutCtrl extends Controller {}

    const cls = LaidOutCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassLayout(cls)).toBe(MainLayoutCtor);
  });

  it('@layout on a method stores the layout class in method layout metadata', () => {
    class MethodLayoutCtrl extends Controller {
      @layout(PrintLayoutCtor)
      @get('print/{id}')
      print(): unknown { return null; }
    }

    const proto = MethodLayoutCtrl.prototype as object;
    expect(getMethodLayout(proto, 'print')).toBe(PrintLayoutCtor);
  });

  it('@layout on method does not affect class layout metadata', () => {
    class MethodOnlyLayoutCtrl extends Controller {
      @layout(PrintLayoutCtor)
      @get()
      index(): unknown { return null; }
    }

    const cls = MethodOnlyLayoutCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassLayout(cls)).toBeUndefined();
  });

  it('second @layout on same class overwrites the first', () => {
    @controller('/overwrote')
    @layout(PrintLayoutCtor)
    @layout(MainLayoutCtor)
    class OverwroteCtrl extends Controller {}

    const cls = OverwroteCtrl as unknown as new (...args: unknown[]) => unknown;
    // Bottom-up: MainLayout applied first, PrintLayout applied second (wins)
    expect(getClassLayout(cls)).toBe(PrintLayoutCtor);
  });

  it('getClassLayout returns undefined for class with no layout decorator', () => {
    @controller('/no-layout')
    class NoLayoutCtrl extends Controller {}

    const cls = NoLayoutCtrl as unknown as new (...args: unknown[]) => unknown;
    expect(getClassLayout(cls)).toBeUndefined();
  });

  it('getMethodLayout returns undefined for undecorated method', () => {
    class AnyCtrl2 extends Controller {
      @get()
      index(): unknown { return null; }
    }
    const proto = AnyCtrl2.prototype as object;
    expect(getMethodLayout(proto, 'index')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Public barrel export
// ---------------------------------------------------------------------------

describe('Public barrel exports', () => {
  it('all decorators and Controller are exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(barrel.Controller).toBeDefined();
    expect(barrel.controller).toBeDefined();
    expect(barrel.retain).toBeDefined();
    expect(barrel.get).toBeDefined();
    expect(barrel.post).toBeDefined();
    expect(barrel.put).toBeDefined();
    expect(barrel.patch).toBeDefined();
    expect(barrel.del).toBeDefined();
    expect(barrel.guard).toBeDefined();
    expect(barrel.layout).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// beforeEach: reset test state isolation note
// ---------------------------------------------------------------------------
// Module-level WeakMaps persist across tests within the same module instance.
// Each test class defined inline is a NEW class object so WeakMap keys never
// collide between tests.  No cleanup needed.
beforeEach(() => {
  // intentionally empty
});
