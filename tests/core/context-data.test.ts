import { describe, it, expect } from 'vitest';
import { ContextData } from '../../src/core/context-data.js';
import { signal } from '../../src/reactivity/signal.js';

// ---------------------------------------------------------------------------
// set():plain values
// ---------------------------------------------------------------------------

describe('ContextData.set():plain values', () => {
  it('stores a string value and returns it via getAll()', () => {
    const data = new ContextData();
    data.set('title', 'All Users');
    expect(data.getAll().title).toBe('All Users');
  });

  it('stores a number value', () => {
    const data = new ContextData();
    data.set('count', 42);
    expect(data.getAll().count).toBe(42);
  });

  it('stores a boolean value', () => {
    const data = new ContextData();
    data.set('isLoading', false);
    expect(data.getAll().isLoading).toBe(false);
  });

  it('stores an object value', () => {
    const user = { id: 1, name: 'Alice' };
    const data = new ContextData();
    data.set('user', user);
    expect(data.getAll().user).toBe(user);
  });

  it('stores multiple keys independently', () => {
    const data = new ContextData();
    data.set('a', 1);
    data.set('b', 2);
    data.set('c', 3);
    const all = data.getAll();
    expect(all.a).toBe(1);
    expect(all.b).toBe(2);
    expect(all.c).toBe(3);
  });

  it('overwrites an existing key with a new value', () => {
    const data = new ContextData();
    data.set('title', 'first');
    data.set('title', 'second');
    expect(data.getAll().title).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// set():signal values
// ---------------------------------------------------------------------------

describe('ContextData.set():signal values', () => {
  it('stores a signal and the same signal reference is returned via getAll()', () => {
    const data = new ContextData();
    const count = signal(0);
    data.set('count', count);
    expect(data.getAll().count).toBe(count);
  });

  it('stores a signal alongside plain values', () => {
    const data = new ContextData();
    const isLoading = signal(true);
    data.set('isLoading', isLoading);
    data.set('pageTitle', 'Dashboard');
    expect(data.getAll().isLoading).toBe(isLoading);
    expect(data.getAll().pageTitle).toBe('Dashboard');
  });
});

// ---------------------------------------------------------------------------
// getAll():retrievability for context assembly
// ---------------------------------------------------------------------------

describe('ContextData.getAll()', () => {
  it('returns an empty record when no values have been set', () => {
    const data = new ContextData();
    expect(Object.keys(data.getAll())).toHaveLength(0);
  });

  it('returns a record containing all stored keys', () => {
    const data = new ContextData();
    data.set('x', 1);
    data.set('y', 2);
    expect(Object.keys(data.getAll())).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('returns the same object reference on repeated calls', () => {
    const data = new ContextData();
    expect(data.getAll()).toBe(data.getAll());
  });
});

// ---------------------------------------------------------------------------
// ViewBag role:accepts any key (no reserved-key enforcement)
// ---------------------------------------------------------------------------

describe('ContextData as ViewBag:accepts any key', () => {
  it('accepts keys that were previously reserved (ViewBag is namespaced under context.data)', () => {
    const data = new ContextData();
    expect(() => { data.set('router', 'custom'); }).not.toThrow();
    expect(() => { data.set('params', 'custom'); }).not.toThrow();
    expect(() => { data.set('model', 'custom'); }).not.toThrow();
    expect(() => { data.set('errors', 'custom'); }).not.toThrow();
  });

  it('stores and retrieves any string key', () => {
    const data = new ContextData();
    data.set('pageTitle', 'My App');
    data.set('currentUser', { id: 1, name: 'Alice' });
    expect(data.getAll().pageTitle).toBe('My App');
    expect(data.getAll().currentUser).toStrictEqual({ id: 1, name: 'Alice' });
  });
});
