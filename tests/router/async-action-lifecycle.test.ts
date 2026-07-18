import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from '../../src/router/router.js';
import type { ViewRenderer, RouterOptions, FailureInfo } from '../../src/router/router.js';
import { Container } from '../../src/di/container.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get, retain, pending, failure, layout, guard } from '../../src/core/decorators.js';
import { View, Redirect } from '../../src/core/view.js';
import { defineLayout } from '../../src/layout/layout.js';
import type { IView, IRouteGuard, LayoutContext, LayoutConstructor } from '../../src/types/index.js';
import type { Fragment } from '../../src/renderer/fragment.js';

// ---------------------------------------------------------------------------
// Deferred and abort helpers
// ---------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Stands in for a fetch bound to a signal: pending until the signal aborts. */
function abortable(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(makeAbortError());
      return;
    }
    signal.addEventListener('abort', () => { reject(makeAbortError()); }, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Controllers (module level so decorators run once)
// ---------------------------------------------------------------------------

const RecLayout: LayoutConstructor = defineLayout({
  template: (() => null) as unknown as (context: LayoutContext) => Fragment,
});

let recDeferred: Deferred<IView> | null = null;
let recSyncThrow: Error | null = null;

@controller('/rec')
@pending('rec/skeleton')
@failure('rec/error')
class RecController extends Controller {
  @get('detail/{id}')
  @pending('rec/detail-skeleton')
  @failure('rec/detail-error')
  @layout(RecLayout)
  async detail(id: string): Promise<IView> {
    void id;
    if (recDeferred !== null) return await recDeferred.promise;
    return View('rec/detail');
  }

  @get()
  async index(): Promise<IView> {
    if (recDeferred !== null) return await recDeferred.promise;
    return View('rec/index');
  }

  @get('sync/{id}')
  syncAction(id: string): IView {
    void id;
    if (recSyncThrow !== null) throw recSyncThrow;
    return View('rec/sync');
  }
}

let plainDeferred: Deferred<IView> | null = null;

@controller('/plain')
class PlainController extends Controller {
  @get()
  async index(): Promise<IView> {
    if (plainDeferred !== null) return await plainDeferred.promise;
    return View('plain/index');
  }
}

let slowSignal: AbortSignal | null = null;
let slowRejection: unknown = null;

@controller('/slow')
class SlowController extends Controller {
  @get()
  async index(): Promise<IView> {
    slowSignal = this.signal;
    try {
      return await abortable(this.signal);
    } catch (err) {
      slowRejection = err;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

let fastSignal: AbortSignal | null = null;

@controller('/fast')
class FastController extends Controller {
  @get()
  index(): Promise<IView> {
    fastSignal = this.signal;
    return Promise.resolve(View('fast/index'));
  }
}

let retainedSignals: AbortSignal[] = [];

@controller('/retained')
@retain()
class RetainedController extends Controller {
  @get()
  index(): Promise<IView> {
    retainedSignals.push(this.signal);
    return Promise.resolve(View('retained/index'));
  }
}

let ignoreDeferred: Deferred<IView> | null = null;

@controller('/ignore')
class IgnoreController extends Controller {
  @get()
  index(): Promise<IView> {
    // Deliberately never reads this.signal.
    if (ignoreDeferred !== null) return ignoreDeferred.promise;
    return Promise.resolve(View('ignore/index'));
  }
}

class DenyGuard implements IRouteGuard {
  canActivate(): boolean {
    return false;
  }
}

let guardedActionRan = false;

@controller('/guarded')
@guard(DenyGuard)
class GuardedController extends Controller {
  @get()
  index(): Promise<IView> {
    guardedActionRan = true;
    return Promise.resolve(View('guarded/index'));
  }
}

// ---------------------------------------------------------------------------
// View renderer that records each mount
// ---------------------------------------------------------------------------

interface MountRecord {
  readonly path: string;
  readonly layoutChain: LayoutConstructor[];
  readonly model: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, string>>;
}

let mounts: MountRecord[] = [];

const recordingRenderer: ViewRenderer = (_iview, context, _outlet, resolvedPath, layoutChain) => {
  mounts.push({
    path: resolvedPath,
    layoutChain,
    model: context.model,
    params: context.params,
  });
  return Promise.resolve();
};

// ---------------------------------------------------------------------------
// Navigation API mock
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn<(path: string, options?: { history: string }) => void>();
const mockNavigation = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  navigate: mockNavigate,
  back: vi.fn(),
  forward: vi.fn(),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let container: Container;
let outlet: Element;

beforeEach(() => {
  vi.stubGlobal('navigation', mockNavigation);
  vi.stubGlobal('location', { pathname: '/', href: 'http://localhost/' });
  vi.stubGlobal('document', {});
  vi.clearAllMocks();

  recDeferred = null;
  recSyncThrow = null;
  plainDeferred = null;
  slowSignal = null;
  slowRejection = null;
  fastSignal = null;
  retainedSignals = [];
  ignoreDeferred = null;
  guardedActionRan = false;
  mounts = [];

  container = new Container();
  outlet = { replaceChildren: vi.fn() } as unknown as Element;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRouter(opts?: Partial<RouterOptions>): Router {
  const router = new Router(container, outlet, {
    viewRenderer: recordingRenderer,
    pendingDelay: 0,
    ...opts,
  });
  router.registerController(RecController);
  router.registerController(PlainController);
  router.registerController(SlowController);
  router.registerController(FastController);
  router.registerController(RetainedController);
  router.registerController(IgnoreController);
  return router;
}

function paths(): string[] {
  return mounts.map((m) => m.path);
}

// ---------------------------------------------------------------------------
// Pending views
// ---------------------------------------------------------------------------

describe('pending views', () => {
  it('mounts the pending view, then replaces it with the real view', async () => {
    recDeferred = makeDeferred<IView>();
    const router = makeRouter();

    const nav = router.handle('http://localhost/rec/detail/5', null);
    await vi.waitFor(() => {
      expect(paths().some((p) => p.includes('detail-skeleton'))).toBe(true);
    });
    expect(mounts).toHaveLength(1);

    recDeferred.resolve(View('rec/detail'));
    await nav;

    expect(paths()).toEqual(['views/rec/detail-skeleton', 'views/rec/detail']);
  });

  it('never mounts a pending view for a synchronous action', async () => {
    const onPending = vi.fn();
    const router = makeRouter({ onPending });

    await router.handle('http://localhost/rec/sync/9', null);

    expect(onPending).not.toHaveBeenCalled();
    expect(paths()).toEqual(['views/rec/sync']);
  });

  it('never mounts a pending view when the action resolves before the threshold', async () => {
    const onPending = vi.fn();
    const router = makeRouter({ onPending, pendingDelay: 1000 });

    await router.handle('http://localhost/rec', null);

    expect(onPending).not.toHaveBeenCalled();
    expect(paths()).toEqual(['views/rec/index']);
  });

  it('wraps the pending view in the same layout chain as the real view', async () => {
    recDeferred = makeDeferred<IView>();
    const router = makeRouter();

    const nav = router.handle('http://localhost/rec/detail/5', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });
    recDeferred.resolve(View('rec/detail'));
    await nav;

    expect(mounts).toHaveLength(2);
    expect(mounts[0]?.layoutChain).toEqual([RecLayout]);
    expect(mounts[1]?.layoutChain).toEqual([RecLayout]);
  });

  it("the pending view's model is null and its params are the navigation's", async () => {
    recDeferred = makeDeferred<IView>();
    const onPending = vi.fn();
    const router = makeRouter({ onPending });

    const nav = router.handle('http://localhost/rec/detail/77', null);
    await vi.waitFor(() => { expect(onPending).toHaveBeenCalledTimes(1); });

    const pendingView = onPending.mock.calls[0]?.[0] as IView;
    expect(pendingView.kind).toBe('view');
    expect(pendingView.kind === 'view' ? pendingView.model : undefined).toBeNull();
    expect(mounts[0]?.params).toMatchObject({ id: '77' });

    recDeferred.resolve(View('rec/detail'));
    await nav;
  });

  it('resolves the pending view action first, then controller', async () => {
    recDeferred = makeDeferred<IView>();
    const router = makeRouter();

    // The action carries @pending('rec/detail-skeleton'), which wins.
    const nav = router.handle('http://localhost/rec/detail/1', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });
    expect(mounts[0]?.path).toContain('detail-skeleton');
    recDeferred.resolve(View('rec/detail'));
    await nav;
  });

  it('falls back to the controller pending view when the action declares none', async () => {
    recDeferred = makeDeferred<IView>();
    const router = makeRouter();

    // index() has no @pending; the controller @pending('rec/skeleton') applies.
    const nav = router.handle('http://localhost/rec', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });
    expect(mounts[0]?.path).toContain('rec/skeleton');
    recDeferred.resolve(View('rec/index'));
    await nav;
  });

  it('falls back to the application default pending view', async () => {
    plainDeferred = makeDeferred<IView>();
    const router = makeRouter({ pendingView: 'shared/pending' });

    const nav = router.handle('http://localhost/plain', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });
    expect(mounts[0]?.path).toContain('shared/pending');
    plainDeferred.resolve(View('plain/index'));
    await nav;
  });

  it('shows nothing when no pending view is resolved at any level', async () => {
    plainDeferred = makeDeferred<IView>();
    const onPending = vi.fn();
    const router = makeRouter({ onPending });

    const nav = router.handle('http://localhost/plain', null);
    // Give the timer a chance to fire; with no pending view, nothing should mount.
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
    expect(onPending).not.toHaveBeenCalled();
    expect(mounts).toHaveLength(0);

    plainDeferred.resolve(View('plain/index'));
    await nav;
    expect(paths()).toEqual(['views/plain/index']);
  });

  it('has a documented default delay used when none is configured', async () => {
    // No pendingDelay override: the default (120ms) is long enough that a fast
    // action never flashes a skeleton.
    const onPending = vi.fn();
    const router = new Router(container, outlet, { viewRenderer: recordingRenderer, onPending });
    router.registerController(RecController);

    await router.handle('http://localhost/rec', null);

    expect(onPending).not.toHaveBeenCalled();
    expect(paths()).toEqual(['views/rec/index']);
  });

  it('does not leave a pending view mounted when the action redirects', async () => {
    recDeferred = makeDeferred<IView>();
    const clearOutlet = vi.fn();
    const router = makeRouter({ clearOutlet });

    const nav = router.handle('http://localhost/rec', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });

    recDeferred.resolve(Redirect('/plain'));
    await nav;

    expect(clearOutlet).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/plain');
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('cancellation', () => {
  it('hands the action a fresh, unaborted AbortSignal', async () => {
    const router = makeRouter();

    await router.handle('http://localhost/fast', null);

    expect(fastSignal).toBeInstanceOf(AbortSignal);
    expect(fastSignal?.aborted).toBe(false);
  });

  it('aborts the signal when the navigation is superseded, rejecting a bound fetch', async () => {
    const router = makeRouter();

    const nav1 = router.handle('http://localhost/slow', null);
    await vi.waitFor(() => { expect(slowSignal).not.toBeNull(); });

    const nav2 = router.handle('http://localhost/fast', null);
    await Promise.all([nav1, nav2]);

    expect(slowSignal?.aborted).toBe(true);
    expect(slowRejection).toBeInstanceOf(Error);
    expect((slowRejection as Error).name).toBe('AbortError');
  });

  it('never mounts an aborted action, even when the new navigation mounted first', async () => {
    const router = makeRouter();

    const nav1 = router.handle('http://localhost/slow', null);
    await vi.waitFor(() => { expect(slowSignal).not.toBeNull(); });
    const nav2 = router.handle('http://localhost/fast', null);
    await Promise.all([nav1, nav2]);

    expect(paths()).toEqual(['views/fast/index']);
  });

  it('does not mount a failure view for an aborted action', async () => {
    const onFailure = vi.fn();
    const router = makeRouter({ onFailure });

    const nav1 = router.handle('http://localhost/slow', null);
    await vi.waitFor(() => { expect(slowSignal).not.toBeNull(); });
    const nav2 = router.handle('http://localhost/fast', null);
    await Promise.all([nav1, nav2]);

    expect(onFailure).not.toHaveBeenCalled();
    expect(paths().some((p) => p.includes('error'))).toBe(false);
  });

  it('hands a retained controller a fresh signal on every visit and can fetch again', async () => {
    const router = makeRouter();

    await router.handle('http://localhost/retained', null);
    await router.handle('http://localhost/fast', null);
    await router.handle('http://localhost/retained', null);

    expect(retainedSignals).toHaveLength(2);
    expect(retainedSignals[0]).not.toBe(retainedSignals[1]);
    expect(retainedSignals[0]?.aborted).toBe(true);
    expect(retainedSignals[1]?.aborted).toBe(false);
    expect(paths().filter((p) => p.includes('retained'))).toHaveLength(2);
  });

  it('aborts the previous signal before the next action runs', async () => {
    const router = makeRouter();

    const nav1 = router.handle('http://localhost/slow', null);
    await vi.waitFor(() => { expect(slowSignal).not.toBeNull(); });
    const nav2 = router.handle('http://localhost/fast', null);
    await Promise.all([nav1, nav2]);

    // The action that ran second never observed a signal aborted by the first.
    expect(fastSignal?.aborted).toBe(false);
    expect(slowSignal?.aborted).toBe(true);
  });

  it('suppresses the late result of an action that ignores the signal', async () => {
    ignoreDeferred = makeDeferred<IView>();
    const router = makeRouter();

    const nav1 = router.handle('http://localhost/ignore', null);
    await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
    const nav2 = router.handle('http://localhost/fast', null);
    await nav2;

    ignoreDeferred.resolve(View('ignore/index'));
    await nav1;

    expect(paths()).toEqual(['views/fast/index']);
  });
});

// ---------------------------------------------------------------------------
// Failure views
// ---------------------------------------------------------------------------

describe('failure views', () => {
  it('mounts the failure view inside the layout chain with the error as its model', async () => {
    recDeferred = makeDeferred<IView>();
    const onFailure = vi.fn<(info: FailureInfo) => void>();
    const router = makeRouter({ onFailure });

    const nav = router.handle('http://localhost/rec/detail/5', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });
    recDeferred.reject(new Error('record load failed'));
    await nav;

    const failureMount = mounts.find((m) => m.path.includes('detail-error'));
    expect(failureMount).toBeDefined();
    expect(failureMount?.layoutChain).toEqual([RecLayout]);
    expect(failureMount?.model).toMatchObject({ message: 'record load failed', name: 'Error' });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('treats a rejecting async action the same as a synchronous throw', async () => {
    recSyncThrow = new Error('sync boom');
    const router = makeRouter();

    await router.handle('http://localhost/rec/sync/1', null);

    expect(paths()).toEqual(['views/rec/error']);
    expect(mounts[0]?.model).toMatchObject({ message: 'sync boom', name: 'Error' });
  });

  it('runs the controller hook, the app handler, and the logger before the failure view mounts', async () => {
    const order: string[] = [];
    const appErrorHandler = vi.fn(() => { order.push('appHandler'); });
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => { order.push('logger'); },
    };

    @controller('/hooked')
    @failure('hooked/error')
    class HookedController extends Controller {
      @get()
      index(): IView {
        throw new Error('boom');
      }

      protected override onActionError(): void {
        order.push('hook');
      }
    }

    const router = new Router(container, outlet, {
      viewRenderer: (_i, _c, _o, resolvedPath): Promise<void> => {
        order.push(`mount:${resolvedPath}`);
        return Promise.resolve();
      },
      appErrorHandler,
      loggerFactory: { create: () => logger },
    });
    router.registerController(HookedController);

    await router.handle('http://localhost/hooked', null);

    expect(order).toEqual(['hook', 'appHandler', 'logger', 'mount:views/hooked/error']);
  });

  it('takes over the outlet with onActionError when no failure view resolves', async () => {
    const onActionError = vi.fn();
    const onFailure = vi.fn<(info: FailureInfo) => void>();

    @controller('/bare')
    class BareController extends Controller {
      @get()
      index(): IView {
        throw new Error('bare boom');
      }
    }

    const router = new Router(container, outlet, {
      viewRenderer: recordingRenderer,
      onActionError,
      onFailure,
    });
    router.registerController(BareController);

    await router.handle('http://localhost/bare', null);

    expect(onActionError).toHaveBeenCalledWith('BareController', 'index', expect.any(Error));
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0].view).toBeNull();
    expect(mounts).toHaveLength(0);
  });

  it('resolves the failure view application default when the route declares none', async () => {
    @controller('/appfail')
    class AppFailController extends Controller {
      @get()
      index(): IView {
        throw new Error('app fail');
      }
    }

    const router = new Router(container, outlet, {
      viewRenderer: recordingRenderer,
      failureView: 'shared/error',
    });
    router.registerController(AppFailController);

    await router.handle('http://localhost/appfail', null);

    expect(paths()).toEqual(['views/shared/error']);
  });

  it('does not recurse when the failure view itself throws; it falls back to onActionError', async () => {
    const onActionError = vi.fn();

    @controller('/doublefail')
    @failure('doublefail/error')
    class DoubleFailController extends Controller {
      @get()
      index(): IView {
        throw new Error('first boom');
      }
    }

    const router = new Router(container, outlet, {
      viewRenderer: (_i, _c, _o, resolvedPath): Promise<void> => {
        return Promise.reject(new Error(`render of ${resolvedPath} failed`));
      },
      onActionError,
    });
    router.registerController(DoubleFailController);

    await router.handle('http://localhost/doublefail', null);

    expect(onActionError).toHaveBeenCalledWith('DoubleFailController', 'index', expect.any(Error));
  });

  it('hands the failure view a narrow model that carries no stack trace', async () => {
    const onFailure = vi.fn<(info: FailureInfo) => void>();

    @controller('/narrow')
    @failure('narrow/error')
    class NarrowController extends Controller {
      @get()
      index(): IView {
        throw new Error('internal detail');
      }
    }

    const router = new Router(container, outlet, { viewRenderer: recordingRenderer, onFailure });
    router.registerController(NarrowController);

    await router.handle('http://localhost/narrow', null);

    const model = mounts[0]?.model ?? {};
    expect(Object.keys(model).sort()).toEqual(['message', 'name']);
    expect(model).not.toHaveProperty('stack');
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('fires one view transition for a navigation that mounts pending then real', async () => {
    const start = vi.fn((callback: () => void | Promise<void>) => ({
      updateCallbackDone: Promise.resolve(callback()),
      finished: new Promise<void>(() => undefined),
    }));
    vi.stubGlobal('document', { startViewTransition: start });

    recDeferred = makeDeferred<IView>();
    const router = makeRouter();

    const nav = router.handle('http://localhost/rec/detail/5', null);
    await vi.waitFor(() => { expect(mounts).toHaveLength(1); });
    // The pending mount did not open a transition.
    expect(start).not.toHaveBeenCalled();

    recDeferred.resolve(View('rec/detail'));
    await nav;

    // Only the real mount opened one.
    expect(start).toHaveBeenCalledTimes(1);
    expect(paths()).toEqual(['views/rec/detail-skeleton', 'views/rec/detail']);
  });

  it('mounts neither a pending nor a failure view when a guard denies navigation', async () => {
    const onPending = vi.fn();
    const onFailure = vi.fn();

    const router = new Router(container, outlet, {
      viewRenderer: recordingRenderer,
      pendingDelay: 0,
      pendingView: 'shared/pending',
      failureView: 'shared/error',
      onPending,
      onFailure,
    });
    router.registerController(GuardedController);

    await router.handle('http://localhost/guarded', null);

    expect(guardedActionRan).toBe(false);
    expect(onPending).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(mounts).toHaveLength(0);
  });
});
