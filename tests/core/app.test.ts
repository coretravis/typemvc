import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../src/core/app.js';
import type { Plugin } from '../../src/types/index.js';

describe('createApp', () => {
  it('creates an app with the given name', () => {
    const app = createApp({ name: 'my-app' });
    expect(app.name).toBe('my-app');
  });

  it('defaults version to 0.0.0', () => {
    const app = createApp({ name: 'my-app' });
    expect(app.version).toBe('0.0.0');
  });

  it('accepts a custom version', () => {
    const app = createApp({ name: 'my-app', version: '1.2.3' });
    expect(app.version).toBe('1.2.3');
  });

  it('runs plugins on start', async () => {
    const setup = vi.fn();
    const plugin: Plugin = { name: 'test-plugin', setup };
    const app = createApp({ name: 'my-app' });
    app.use(plugin);
    await app.start();
    expect(setup).toHaveBeenCalledOnce();
  });

  it('supports chaining use()', async () => {
    const calls: string[] = [];
    const pluginA: Plugin = { name: 'a', setup: () => { calls.push('a'); } };
    const pluginB: Plugin = { name: 'b', setup: () => { calls.push('b'); } };
    const app = createApp({ name: 'my-app' });
    app.use(pluginA).use(pluginB);
    await app.start();
    expect(calls).toEqual(['a', 'b']);
  });
});
