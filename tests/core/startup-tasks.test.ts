// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { Controller } from '../../src/core/controller.js';
import { controller, get } from '../../src/core/decorators.js';
import { EmptyView } from '../../src/core/view.js';
import { ROUTER } from '../../src/router/tokens.js';
import type { Container } from '../../src/di/container.js';
import type { LogEntry, LogProvider } from '../../src/logging/types.js';
import type { AppBuilder, ErrorHandler, IRouter, IView } from '../../src/types/index.js';
// Imported from the barrel, not from types/: the public export is what is under test.
import type { AppHandle, IStartupTask } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Navigation API mock
// ---------------------------------------------------------------------------

const mockNavigation = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  navigate: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const order: string[] = [];

@controller('/startup')
class StartupPageController extends Controller {
  @get()
  index(): IView {
    order.push('navigation');
    return EmptyView();
  }
}

const TASK_A = Symbol('TaskA');
const TASK_B = Symbol('TaskB');
const TASK_C = Symbol('TaskC');
const GREETER = Symbol('Greeter');

/** Collects every log entry so a test can assert on what the framework reported. */
class RecordingLogProvider implements LogProvider {
  readonly entries: LogEntry[] = [];

  log(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

let outlet: Element;
let logs: RecordingLogProvider;
let apps: AppHandle[];

function boot(
  configure: (app: AppBuilder) => void,
  onError?: ErrorHandler,
): AppHandle {
  const app = bootstrap({
    outlet,
    configure,
    logging: { provider: logs },
    ...(onError !== undefined ? { onError } : {}),
  });
  apps.push(app);
  return app;
}

/** Lets the first navigation (queued by bootstrap) and any task promise settle. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
}

/** The errors bootstrap itself reported, not those the container logs on its own behalf. */
function errorMessages(): string[] {
  return logs.entries
    .filter((e) => e.level === 'error' && e.category === 'TypeMVC.Bootstrap')
    .map((e) => e.message);
}

beforeEach(() => {
  outlet = document.createElement('div');
  logs = new RecordingLogProvider();
  apps = [];
  order.length = 0;
  vi.stubGlobal('navigation', mockNavigation);
  vi.stubGlobal('location', { pathname: '/startup', href: 'http://localhost/startup' });
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const app of apps) await app.stop();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe('onStart resolution', () => {
  it('resolves the token after the container is sealed and before the first navigation', async () => {
    boot((app) => {
      app.singleton(TASK_A, () => {
        order.push('constructed');
        return {};
      });
      app.route(StartupPageController);
      app.onStart(TASK_A);
    });

    expect(order).toEqual(['constructed']);
    await settle();
    expect(order).toEqual(['constructed', 'navigation']);
  });

  it('resolves the same singleton instance the container hands to everyone else', () => {
    const instance = { name: 'service' };
    const app = boot((builder) => {
      builder.singleton(TASK_A, () => instance);
      builder.onStart(TASK_A);
    });

    expect(app.container.resolve(TASK_A)).toBe(instance);
  });

  it('constructs a service that has no start hook and does nothing else', async () => {
    let constructed = 0;
    boot((app) => {
      app.singleton(TASK_A, () => {
        constructed++;
        return { unrelated: (): void => { throw new Error('never called'); } };
      });
      app.route(StartupPageController);
      app.onStart(TASK_A);
    });

    await settle();
    expect(constructed).toBe(1);
    expect(errorMessages()).toEqual([]);
    expect(order).toContain('navigation');
  });

  it('starts a token registered twice exactly once', () => {
    const start = vi.fn();
    boot((app) => {
      app.singleton(TASK_A, () => ({ start }));
      app.onStart(TASK_A);
      app.onStart(TASK_A);
    });

    expect(start).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// The start hook
// ---------------------------------------------------------------------------

describe('start hook', () => {
  it('calls start() once on a resolved task', () => {
    const start = vi.fn();
    boot((app) => {
      app.singleton(TASK_A, () => ({ start }));
      app.onStart(TASK_A);
    });

    expect(start).toHaveBeenCalledOnce();
  });

  it('calls start() with the task as its receiver', () => {
    class Counted implements IStartupTask {
      started = 0;
      start(): void {
        this.started++;
      }
    }
    const task = new Counted();

    boot((app) => {
      app.singleton(TASK_A, () => task);
      app.onStart(TASK_A);
    });

    expect(task.started).toBe(1);
  });

  it('runs tasks in registration order', () => {
    boot((app) => {
      app.singleton(TASK_A, () => ({ start: (): void => { order.push('a'); } }));
      app.singleton(TASK_B, () => ({ start: (): void => { order.push('b'); } }));
      app.singleton(TASK_C, () => ({ start: (): void => { order.push('c'); } }));
      app.onStart(TASK_A);
      app.onStart(TASK_B);
      app.onStart(TASK_C);
    });

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('starts a task that injects the router and lets it navigate', () => {
    class Navigator implements IStartupTask {
      readonly #router: IRouter;
      constructor(router: IRouter) {
        this.#router = router;
      }
      start(): void {
        this.#router.navigateTo('/books');
      }
    }

    boot((app) => {
      app.singleton(TASK_A, (c: Container) => new Navigator(c.resolve<IRouter>(ROUTER)));
      app.onStart(TASK_A);
    });

    expect(mockNavigation.navigate).toHaveBeenCalledWith('/books');
  });

  it('starts a task that injects another registered service', () => {
    class Greeter {
      greet(): string {
        return 'hello';
      }
    }
    let greeting = '';

    boot((app) => {
      app.singleton(GREETER, () => new Greeter());
      app.singleton(TASK_A, (c: Container) => {
        const greeter = c.resolve<Greeter>(GREETER);
        return { start: (): void => { greeting = greeter.greet(); } };
      });
      app.onStart(TASK_A);
    });

    expect(greeting).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Failure containment
// ---------------------------------------------------------------------------

describe('a failing task is contained', () => {
  it('logs a throwing start(), names the token, and runs the later tasks and the first navigation', async () => {
    boot((app) => {
      app.singleton(TASK_A, () => ({
        start: (): void => { throw new Error('analytics is down'); },
      }));
      app.singleton(TASK_B, () => ({ start: (): void => { order.push('b'); } }));
      app.route(StartupPageController);
      app.onStart(TASK_A);
      app.onStart(TASK_B);
    });

    await settle();
    expect(errorMessages()).toEqual(['Startup task "TaskA" threw from start()']);
    expect(order).toEqual(['b', 'navigation']);
  });

  it('passes a throwing start() to the application error handler', () => {
    const onError = vi.fn<ErrorHandler>();
    const failure = new Error('analytics is down');

    boot((app) => {
      app.singleton(TASK_A, () => ({ start: (): void => { throw failure; } }));
      app.onStart(TASK_A);
    }, onError);

    expect(onError).toHaveBeenCalledWith(failure, 'TaskA', expect.objectContaining({ phase: 'startup' }));
  });

  it('does not require an application error handler to report the failure', () => {
    expect(() => {
      boot((app) => {
        app.singleton(TASK_A, () => ({ start: (): void => { throw new Error('boom'); } }));
        app.onStart(TASK_A);
      });
    }).not.toThrow();

    expect(errorMessages()).toEqual(['Startup task "TaskA" threw from start()']);
  });

  it('reports an unregistered token and still runs the later tasks and the first navigation', async () => {
    const onError = vi.fn<ErrorHandler>();

    boot((app) => {
      app.singleton(TASK_B, () => ({ start: (): void => { order.push('b'); } }));
      app.route(StartupPageController);
      app.onStart(TASK_A);
      app.onStart(TASK_B);
    }, onError);

    await settle();
    expect(errorMessages()).toEqual(['Startup task "TaskA" could not be resolved, so it did not start']);
    expect(onError).toHaveBeenCalledOnce();
    expect(order).toEqual(['b', 'navigation']);
  });

  it('reports a factory that throws while constructing the task', () => {
    boot((app) => {
      app.singleton(TASK_A, () => { throw new Error('bad config'); });
      app.onStart(TASK_A);
    });

    expect(errorMessages()).toEqual(['Startup task "TaskA" could not be resolved, so it did not start']);
  });
});

// ---------------------------------------------------------------------------
// Async tasks
// ---------------------------------------------------------------------------

describe('an async task', () => {
  it('is not awaited before the first navigation', async () => {
    // A holder object, so the closure assignment does not narrow the type away.
    const pending: { settle: (() => void) | null } = { settle: null };

    boot((app) => {
      app.singleton(TASK_A, () => ({
        start: (): Promise<void> => {
          order.push('start');
          return new Promise<void>((resolve) => { pending.settle = resolve; });
        },
      }));
      app.route(StartupPageController);
      app.onStart(TASK_A);
    });

    await settle();
    // The task's promise is still pending, and the first route has already rendered.
    expect(order).toEqual(['start', 'navigation']);
    pending.settle?.();
  });

  it('logs a rejection instead of leaving it unhandled', async () => {
    const onError = vi.fn<ErrorHandler>();
    const failure = new Error('socket refused');

    boot((app) => {
      app.singleton(TASK_A, () => ({ start: (): Promise<void> => Promise.reject(failure) }));
      app.route(StartupPageController);
      app.onStart(TASK_A);
    }, onError);

    expect(errorMessages()).toEqual([]);
    await settle();
    expect(errorMessages()).toEqual(['Startup task "TaskA" threw from start()']);
    expect(onError).toHaveBeenCalledWith(failure, 'TaskA', expect.objectContaining({ phase: 'startup' }));
    expect(order).toEqual(['navigation']);
  });
});

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

describe('onStart and the sealed builder', () => {
  it('accepts onStart inside configure', () => {
    expect(() => {
      boot((app) => {
        app.singleton(TASK_A, () => ({}));
        app.onStart(TASK_A);
      });
    }).not.toThrow();
  });

  it('returns the builder so onStart chains', () => {
    boot((app) => {
      const returned = app.singleton(TASK_A, () => ({})).onStart(TASK_A);
      expect(returned).toBe(app);
    });
  });

  it('throws the sealed-builder error when called after bootstrap completes', () => {
    let builder!: AppBuilder;
    boot((app) => { builder = app; });

    expect(() => { builder.onStart(TASK_A); }).toThrow('[TypeMVC] AppBuilder is sealed.');
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe('the application handle', () => {
  it('runs stop() on every task that has one', async () => {
    const stopA = vi.fn();
    const stopC = vi.fn();

    const app = boot((builder) => {
      builder.singleton(TASK_A, () => ({ start: (): void => undefined, stop: stopA }));
      builder.singleton(TASK_B, () => ({ start: (): void => undefined }));
      builder.singleton(TASK_C, () => ({ start: (): void => undefined, stop: stopC }));
      builder.onStart(TASK_A);
      builder.onStart(TASK_B);
      builder.onStart(TASK_C);
    });

    await app.stop();
    expect(stopA).toHaveBeenCalledOnce();
    expect(stopC).toHaveBeenCalledOnce();
  });

  it('starts and stops a listening task without leaking the listener', async () => {
    let hits = 0;

    class ShortcutTask implements IStartupTask {
      readonly #onKeyDown = (): void => { hits++; };

      start(): void {
        document.addEventListener('keydown', this.#onKeyDown);
      }

      stop(): void {
        document.removeEventListener('keydown', this.#onKeyDown);
      }
    }

    const app = boot((builder) => {
      builder.singleton(TASK_A, () => new ShortcutTask());
      builder.onStart(TASK_A);
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(hits).toBe(1);

    await app.stop();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(hits).toBe(1);
  });

  it('awaits an async stop()', async () => {
    let stopped = false;

    const app = boot((builder) => {
      builder.singleton(TASK_A, () => ({
        start: (): void => undefined,
        stop: async (): Promise<void> => {
          await Promise.resolve();
          stopped = true;
        },
      }));
      builder.onStart(TASK_A);
    });

    await app.stop();
    expect(stopped).toBe(true);
  });

  it('stops the remaining tasks when one stop() throws, and reports it', async () => {
    const onError = vi.fn<ErrorHandler>();
    const stopB = vi.fn();
    const failure = new Error('close failed');

    const app = boot((builder) => {
      builder.singleton(TASK_A, () => ({
        start: (): void => undefined,
        stop: (): void => { throw failure; },
      }));
      builder.singleton(TASK_B, () => ({ start: (): void => undefined, stop: stopB }));
      builder.onStart(TASK_A);
      builder.onStart(TASK_B);
    }, onError);

    await app.stop();
    expect(stopB).toHaveBeenCalledOnce();
    expect(errorMessages()).toEqual(['Startup task "TaskA" threw from stop()']);
    expect(onError).toHaveBeenCalledWith(failure, 'TaskA', expect.objectContaining({ phase: 'startup' }));
  });

  it('is a no-op when stopped twice', async () => {
    const stop = vi.fn();

    const app = boot((builder) => {
      builder.singleton(TASK_A, () => ({ start: (): void => undefined, stop }));
      builder.onStart(TASK_A);
    });

    await app.stop();
    await app.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not stop a task whose resolution failed', async () => {
    const app = boot((builder) => {
      builder.onStart(TASK_A);
    });

    await expect(app.stop()).resolves.toBeUndefined();
  });

  it('exposes the sealed container and a stop function', () => {
    const app = boot((builder) => {
      builder.singleton(TASK_A, () => ({ value: 42 }));
      builder.onStart(TASK_A);
    });

    expect(typeof app.stop).toBe('function');
    expect(app.container.resolve(TASK_A)).toEqual({ value: 42 });
  });

  it('leaves a caller that ignores the return value working', async () => {
    expect(() => {
      bootstrap({
        outlet,
        configure: (app) => { app.route(StartupPageController); },
        logging: { provider: logs },
      });
    }).not.toThrow();

    await settle();
    expect(order).toEqual(['navigation']);
  });
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

describe('public API', () => {
  it('exports IStartupTask and AppHandle from the barrel', async () => {
    const barrel = await import('../../src/index.js');
    // The type-only imports at the top of this file are the compile-time proof;
    // this asserts the module they come from is the published barrel.
    const task: IStartupTask = { start: (): void => undefined };
    expect(typeof barrel.bootstrap).toBe('function');
    expect(typeof task.start).toBe('function');
  });
});
