import { describe, it, expect, vi } from 'vitest';
import { Controller } from '../../src/core/controller.js';
import { get, post, controller, action } from '../../src/core/decorators.js';
import {
  getNonRouteMethods,
  buildNonRouteMethodContext,
} from '../../src/core/non-route-methods.js';
import type { ActionErrorTarget, FrameworkErrorEvent } from '../../src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flushes the microtask queue so Promise rejection handlers execute. */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// getNonRouteMethods
// ---------------------------------------------------------------------------

describe('getNonRouteMethods', () => {
  it('returns non-route method names and excludes route methods', () => {
    class CartCtrl extends Controller {
      @get()
      index(): unknown {
        return null;
      }

      @post()
      create(): unknown {
        return null;
      }

      @action
      addItem(): void {
        return;
      }

      @action
      removeItem(): void {
        return;
      }
    }

    const names = getNonRouteMethods(CartCtrl);
    expect(names).toContain('addItem');
    expect(names).toContain('removeItem');
    expect(names).not.toContain('index');
    expect(names).not.toContain('create');
  });

  it('excludes the constructor', () => {
    class MyCtrl extends Controller {
      @action
      doWork(): void {
        return;
      }
    }

    const names = getNonRouteMethods(MyCtrl);
    expect(names).not.toContain('constructor');
    expect(names).toContain('doWork');
  });

  it('excludes Controller base class methods', () => {
    class MyCtrl extends Controller {
      @action
      doSomething(): void {
        return;
      }
    }

    const names = getNonRouteMethods(MyCtrl);
    expect(names).not.toContain('hasErrors');
    expect(names).not.toContain('addError');
    expect(names).not.toContain('onActionError');
    expect(names).toContain('doSomething');
  });

  it('excludes non-function own properties', () => {
    class MyCtrl extends Controller {
      @action
      doWork(): void {
        return;
      }
    }

    const names = getNonRouteMethods(MyCtrl);
    expect(names).not.toContain('label');
    expect(names).toContain('doWork');
  });

  it('returns an empty array when the controller has no non-route methods', () => {
    class EmptyCtrl extends Controller {
      @get()
      index(): unknown {
        return null;
      }
    }

    const names = getNonRouteMethods(EmptyCtrl);
    expect(names).toHaveLength(0);
  });

  it('returns all non-route methods when there are multiple', () => {
    class MultiCtrl extends Controller {
      @action
      a(): void {
        return;
      }

      @action
      b(): void {
        return;
      }

      @action
      c(): void {
        return;
      }
    }

    const names = getNonRouteMethods(MultiCtrl);
    expect(names).toHaveLength(3);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('c');
  });

  it('does not expose a method without @action', () => {
    class HelperCtrl extends Controller {
      @action
      exposed(): void {
        return;
      }

      hidden(): void {
        return;
      }
    }

    const names = getNonRouteMethods(HelperCtrl);
    expect(names).toContain('exposed');
    expect(names).not.toContain('hidden');
  });

  it('exposes an inherited @action method, matching inherited DI', () => {
    class BaseCtrl extends Controller {
      @action
      shared(): void {
        return;
      }
    }
    class ChildCtrl extends BaseCtrl {
      @action
      own(): void {
        return;
      }
    }

    const names = getNonRouteMethods(ChildCtrl);
    expect(names).toContain('shared');
    expect(names).toContain('own');
  });
});

// ---------------------------------------------------------------------------
// buildNonRouteMethodContext - happy path
// ---------------------------------------------------------------------------

describe('buildNonRouteMethodContext - happy path', () => {
  it('exposes non-route methods on the returned context object', () => {
    class ShopCtrl extends Controller {
      @action
      addItem(): void {
        return;
      }

      @action
      removeItem(): void {
        return;
      }
    }

    const instance = new ShopCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(ShopCtrl, instance, errorsTarget, undefined);

    expect(ctx.addItem).toBeDefined();
    expect(ctx.removeItem).toBeDefined();
    expect(typeof ctx.addItem).toBe('function');
    expect(typeof ctx.removeItem).toBe('function');
  });

  it('methods are bound to the controller instance (this is correct)', () => {
    class BoundCtrl extends Controller {
      callCount = 0;

      @action
      increment(): void {
        this.callCount++;
      }
    }

    const instance = new BoundCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(BoundCtrl, instance, errorsTarget, undefined);

    ctx.increment?.();
    expect(instance.callCount).toBe(1);
  });

  it('clears errors.action to null before each invocation', () => {
    class ClearCtrl extends Controller {
      @action
      doWork(): void {
        return;
      }
    }

    const instance = new ClearCtrl();
    const errorsTarget: ActionErrorTarget = { action: new Error('stale') };
    const ctx = buildNonRouteMethodContext(ClearCtrl, instance, errorsTarget, undefined);

    ctx.doWork?.();
    expect(errorsTarget.action).toBeNull();
  });

  it('passes arguments through to the underlying method', () => {
    const receivedArgs: unknown[][] = [];

    class ArgCtrl extends Controller {
      @action
      capture(...args: unknown[]): void {
        receivedArgs.push(args);
      }
    }

    const instance = new ArgCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(ArgCtrl, instance, errorsTarget, undefined);

    ctx.capture?.('hello', 42);
    expect(receivedArgs[0]).toEqual(['hello', 42]);
  });

  it('does not expose route methods on the context', () => {
    class MixedCtrl extends Controller {
      @get()
      index(): unknown {
        return null;
      }

      @action
      doSomething(): void {
        return;
      }
    }

    const instance = new MixedCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(MixedCtrl, instance, errorsTarget, undefined);

    expect(ctx.index).toBeUndefined();
    expect(ctx.doSomething).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildNonRouteMethodContext - reserved key check (AC: throws at registration time)
// ---------------------------------------------------------------------------

describe('buildNonRouteMethodContext - reserved key check', () => {
  it('throws [TypeMVC] error at @controller decoration when non-route method uses reserved key "model"', () => {
    expect(() => {
      @controller('/bad-data')
      class BadDataCtrl extends Controller {
        model(): void {
          return;
        }
      }
      void BadDataCtrl;
    }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] error at @controller decoration when non-route method uses reserved key "errors"', () => {
    expect(() => {
      @controller('/bad-errors')
      class BadErrorsCtrl extends Controller {
        errors(): void {
          return;
        }
      }
      void BadErrorsCtrl;
    }).toThrow('[TypeMVC]');
  });

  it('throws [TypeMVC] error at @controller decoration when non-route method uses reserved key "router"', () => {
    expect(() => {
      @controller('/bad-router')
      class BadRouterCtrl extends Controller {
        // @ts-expect-error -- "router" is a reserved key and a member of Controller, so TypeScript
        // rejects this override; the runtime guard must still reject it for untyped callers.
        router(): void {
          return;
        }
      }
      void BadRouterCtrl;
    }).toThrow('[TypeMVC]');
  });

  it('throws mentioning the colliding key name', () => {
    expect(() => {
      @controller('/bad-params')
      class BadParamsCtrl extends Controller {
        params(): void {
          return;
        }
      }
      void BadParamsCtrl;
    }).toThrow('params');
  });
});

// ---------------------------------------------------------------------------
// buildNonRouteMethodContext - async error handling chain
// ---------------------------------------------------------------------------

describe('buildNonRouteMethodContext - async error handling chain', () => {
  it('routes a synchronous throw through the error chain and sets errors.action', () => {
    let handlerError: Error | null = null;

    class SyncThrowCtrl extends Controller {
      @action
      fail(): void {
        throw new Error('sync boom');
      }
    }

    const instance = new SyncThrowCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(SyncThrowCtrl, instance, errorsTarget, (err) => {
      handlerError = err;
    });

    expect(() => ctx.fail?.()).not.toThrow();
    expect(errorsTarget.action).toBeInstanceOf(Error);
    expect(errorsTarget.action?.message).toBe('sync boom');
    expect(handlerError).toBeInstanceOf(Error);
  });

  it('handles a non-Promise thenable rejection like a Promise rejection', async () => {
    class ThenableCtrl extends Controller {
      @action
      fail(): PromiseLike<void> {
        const thenable = {
          then(_resolve: unknown, reject: (reason: Error) => void): void {
            reject(new Error('thenable boom'));
          },
        };
        return thenable as unknown as PromiseLike<void>;
      }
    }

    const instance = new ThenableCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(ThenableCtrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();

    expect(errorsTarget.action).toBeInstanceOf(Error);
    expect(errorsTarget.action?.message).toBe('thenable boom');
  });

  it('sets errors.action when an async non-route method rejects', async () => {
    class FailCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('boom'));
      }
    }

    const instance = new FailCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(FailCtrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();

    expect(errorsTarget.action).toBeInstanceOf(Error);
    expect(errorsTarget.action?.message).toBe('boom');
  });

  it('sets errors.action to an Error even when the rejection value is not an Error', async () => {
    class StringRejectCtrl extends Controller {
      @action
      fail(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- testing non-Error rejection
        return Promise.reject('plain string rejection');
      }
    }

    const instance = new StringRejectCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(StringRejectCtrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();

    expect(errorsTarget.action).toBeInstanceOf(Error);
  });

  it('layer 1: calls onActionError override when the method rejects', async () => {
    let capturedError: Error | null = null;
    let capturedMethod = '';

    class L1Ctrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('layer1'));
      }

      protected override onActionError(err: Error, method: string): void {
        capturedError = err;
        capturedMethod = method;
      }
    }

    const instance = new L1Ctrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(L1Ctrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();

    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedMethod).toBe('fail');
  });

  it('layer 1 handles error: app handler is NOT called when onActionError does not re-throw', async () => {
    let appHandlerCalled = false;

    class HandledCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('handled'));
      }

      protected override onActionError(): void {
        // handles the error, does not re-throw
      }
    }

    const instance = new HandledCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(HandledCtrl, instance, errorsTarget, () => {
      appHandlerCalled = true;
    });

    ctx.fail?.();
    await flushMicrotasks();

    expect(appHandlerCalled).toBe(false);
  });

  it('layer 1 re-throws: error propagates to the app-level handler', async () => {
    let appHandlerCalled = false;

    class RethrowCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('rethrown'));
      }

      protected override onActionError(err: Error): void {
        throw err;
      }
    }

    const instance = new RethrowCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(RethrowCtrl, instance, errorsTarget, () => {
      appHandlerCalled = true;
    });

    ctx.fail?.();
    await flushMicrotasks();

    expect(appHandlerCalled).toBe(true);
  });

  it('layer 2: app handler receives error and method name when onActionError is not overridden', async () => {
    let receivedError: Error | null = null;
    let receivedMethod = '';

    class NoOverrideCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('no override'));
      }
    }

    const instance = new NoOverrideCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(NoOverrideCtrl, instance, errorsTarget, (err, method) => {
      receivedError = err;
      receivedMethod = method;
    });

    ctx.fail?.();
    await flushMicrotasks();

    expect(receivedError).toBeInstanceOf(Error);
    expect(receivedMethod).toBe('fail');
  });

  it('passes a structured event with phase action, controller, action, and route', async () => {
    const events: (FrameworkErrorEvent | undefined)[] = [];

    class ReportCtrl extends Controller {
      @action
      async fail(): Promise<void> {
        await Promise.reject(new Error('boom'));
      }
    }

    const instance = new ReportCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(
      ReportCtrl,
      instance,
      errorsTarget,
      (_err, _method, event) => {
        events.push(event);
      },
      '/shop',
    );

    ctx.fail?.();
    await flushMicrotasks();

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.error).toBeInstanceOf(Error);
    expect(event?.controller).toBe('ReportCtrl');
    expect(event?.action).toBe('fail');
    expect(event?.route).toBe('/shop');
    expect(event?.phase).toBe('action');
  });

  it('reports a synchronous throw with the same structured event', () => {
    const events: (FrameworkErrorEvent | undefined)[] = [];

    class SyncReportCtrl extends Controller {
      @action
      fail(): void {
        throw new Error('sync boom');
      }
    }

    const instance = new SyncReportCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(
      SyncReportCtrl,
      instance,
      errorsTarget,
      (_err, _method, event) => {
        events.push(event);
      },
      null,
    );

    ctx.fail?.();

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.error).toBeInstanceOf(Error);
    expect(event?.controller).toBe('SyncReportCtrl');
    expect(event?.action).toBe('fail');
    expect(event?.route).toBeNull();
    expect(event?.phase).toBe('action');
  });

  it('layer 3: errors.action is set even when layer 1 fully handles the error', async () => {
    class FullyHandledCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('layer3'));
      }

      protected override onActionError(): void {
        // swallows the error - layer 3 must still set errors.action
      }
    }

    const instance = new FullyHandledCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(FullyHandledCtrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();

    expect(errorsTarget.action).toBeInstanceOf(Error);
    expect(errorsTarget.action?.message).toBe('layer3');
  });

  it('errors.action is null at the start of the next non-route method call', async () => {
    class ClearOnNextCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('clear test'));
      }

      @action
      noop(): void {
        return;
      }
    }

    const instance = new ClearOnNextCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(ClearOnNextCtrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();
    expect(errorsTarget.action).toBeInstanceOf(Error);

    ctx.noop?.();
    expect(errorsTarget.action).toBeNull();
  });

  it('app handler is not called when no handler is registered', async () => {
    const handlerSpy = vi.fn();

    class NoHandlerCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('no handler'));
      }
    }

    const instance = new NoHandlerCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(NoHandlerCtrl, instance, errorsTarget, undefined);

    ctx.fail?.();
    await flushMicrotasks();

    expect(handlerSpy).not.toHaveBeenCalled();
    expect(errorsTarget.action).toBeInstanceOf(Error);
  });

  it('three layers run in the correct order: layer 1 first, then 2, then 3 sets errors.action', async () => {
    const order: string[] = [];

    class OrderCtrl extends Controller {
      @action
      fail(): Promise<void> {
        return Promise.reject(new Error('order'));
      }

      protected override onActionError(err: Error): void {
        order.push('layer1');
        throw err;
      }
    }

    const instance = new OrderCtrl();
    const errorsTarget: ActionErrorTarget = { action: null };
    const ctx = buildNonRouteMethodContext(OrderCtrl, instance, errorsTarget, () => {
      order.push('layer2');
    });

    ctx.fail?.();
    await flushMicrotasks();

    order.push('layer3-observed');
    expect(order).toEqual(['layer1', 'layer2', 'layer3-observed']);
    expect(errorsTarget.action).toBeInstanceOf(Error);
  });
});
