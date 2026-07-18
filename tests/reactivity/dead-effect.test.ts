import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signal, effect } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an effect that tracks no signal on its first run', () => {
  it('warns once, naming the cause and the fix, with a stack', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const isOpen = signal(false);
    const drawer: { element: object | null } = { element: null };

    effect(() => {
      // The element does not exist yet on the first run, so the read below, and with
      // it the subscription to isOpen, is never reached.
      if (drawer.element === null) return;
      isOpen.get();
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const call = warn.mock.calls[0];
    expect(String(call?.[0])).toContain('[TypeMVC]');
    expect(String(call?.[0])).toContain('never run again');
    expect(String(call?.[0])).toContain('returned early');
    expect(String(call?.[1])).toContain('dead-effect.test.ts');
  });

  it('warns only once even after the effect is scheduled again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const source = signal(0);
    let reads = false;

    const dispose = effect(() => {
      if (!reads) return;
      source.get();
    });

    reads = true;
    source.set(1);
    flush();
    dispose();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('an effect that is not dead', () => {
  it('does not warn when it reads a signal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const count = signal(0);

    const dispose = effect(() => {
      count.get();
    });
    dispose();

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when a later run narrows to no dependencies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const enabled = signal(true);
    const label = signal('a');

    const dispose = effect(() => {
      if (enabled.get()) {
        label.get();
      }
    });

    enabled.set(false);
    flush();
    dispose();

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn for an effect that is already disposed when it runs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const count = signal(0);

    const dispose = effect(() => {
      count.get();
    });
    dispose();
    count.set(1);
    flush();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the dead effect check', () => {
  it('is compiled out of a production build: the warning sits behind __DEV__', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/reactivity/signal.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/if \(__DEV__\) \{\s*warnIfNeverTracked\(node\);/);
  });
});
