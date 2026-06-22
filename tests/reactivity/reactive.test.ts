import { describe, it, expect, beforeEach } from 'vitest';
import { reactive } from '../../src/reactivity/reactive.js';
import { effect } from '../../src/reactivity/signal.js';
import { flush } from '../../src/reactivity/scheduler.js';

beforeEach(() => {
  flush();
});

// ---------------------------------------------------------------------------
// Flat objects
// ---------------------------------------------------------------------------

describe('reactive() flat objects', () => {
  it('reads the initial property value', () => {
    const obj = reactive({ x: 1 });
    expect(obj.x).toBe(1);
  });

  it('writes update the property value', () => {
    const obj = reactive({ x: 1 });
    obj.x = 42;
    expect(obj.x).toBe(42);
  });

  it('property read inside an effect registers a dependency', () => {
    const obj = reactive({ count: 0 });
    let seen = 0;
    let runs = 0;
    const dispose = effect(() => {
      seen = obj.count;
      runs++;
    });
    expect(runs).toBe(1);
    expect(seen).toBe(0);
    obj.count = 5;
    flush();
    expect(runs).toBe(2);
    expect(seen).toBe(5);
    dispose();
  });

  it('writing the same value is a no-op (effect not re-run)', () => {
    const obj = reactive({ x: 10 });
    let runs = 0;
    const dispose = effect(() => {
      obj.x; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    expect(runs).toBe(1);
    obj.x = 10; // same value
    flush();
    expect(runs).toBe(1);
    dispose();
  });

  it('multiple independent properties each track separately', () => {
    const obj = reactive({ a: 1, b: 2 });
    let seenA = 0;
    let seenB = 0;
    const disposeA = effect(() => {
      seenA = obj.a;
    });
    const disposeB = effect(() => {
      seenB = obj.b;
    });
    obj.a = 10;
    flush();
    expect(seenA).toBe(10);
    expect(seenB).toBe(2); // b effect not re-run
    obj.b = 20;
    flush();
    expect(seenB).toBe(20);
    disposeA();
    disposeB();
  });

  it('preserves the same keys as the original object', () => {
    const original = { name: 'Alice', age: 30 };
    const obj = reactive(original);
    expect(Object.keys(obj)).toEqual(Object.keys(original));
  });

  it('returns the same proxy for the same object (idempotent)', () => {
    const original = { x: 1 };
    const p1 = reactive(original);
    const p2 = reactive(original);
    expect(p1).toBe(p2);
  });

  it('calling reactive() on a proxy returns the same proxy', () => {
    const original = { x: 1 };
    const p1 = reactive(original);
    const p2 = reactive(p1);
    expect(p1).toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// Nested objects
// ---------------------------------------------------------------------------

describe('reactive() nested objects', () => {
  it('nested object property reads are reactive', () => {
    const obj = reactive({ inner: { y: 2 } });
    let seen = 0;
    let runs = 0;
    const dispose = effect(() => {
      seen = obj.inner.y;
      runs++;
    });
    expect(seen).toBe(2);
    obj.inner.y = 99;
    flush();
    expect(runs).toBe(2);
    expect(seen).toBe(99);
    dispose();
  });

  it('deeply nested three levels', () => {
    const obj = reactive({ a: { b: { c: 0 } } });
    let seen = 0;
    const dispose = effect(() => {
      seen = obj.a.b.c;
    });
    expect(seen).toBe(0);
    obj.a.b.c = 7;
    flush();
    expect(seen).toBe(7);
    dispose();
  });

  it('replacing the nested object with a new one triggers the effect', () => {
    const obj = reactive({ inner: { y: 1 } });
    let seen = 0;
    const dispose = effect(() => {
      seen = obj.inner.y;
    });
    expect(seen).toBe(1);
    obj.inner = { y: 55 };
    flush();
    expect(seen).toBe(55);
    dispose();
  });
});

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

describe('reactive() arrays', () => {
  it('length read inside an effect re-runs when push is called', () => {
    const arr = reactive([1, 2, 3]);
    let seen = 0;
    const dispose = effect(() => {
      seen = arr.length;
    });
    expect(seen).toBe(3);
    arr.push(4);
    flush();
    expect(seen).toBe(4);
    dispose();
  });

  it('push triggers effects', () => {
    const arr = reactive<number[]>([]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    expect(runs).toBe(1);
    arr.push(1);
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('pop triggers effects', () => {
    const arr = reactive([1, 2, 3]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    arr.pop();
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('shift triggers effects', () => {
    const arr = reactive([1, 2, 3]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    arr.shift();
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('unshift triggers effects', () => {
    const arr = reactive([10, 20]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    arr.unshift(5);
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('splice triggers effects', () => {
    const arr = reactive([1, 2, 3, 4]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    arr.splice(1, 1);
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('sort triggers effects', () => {
    const arr = reactive([3, 1, 2]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    arr.sort();
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('reverse triggers effects', () => {
    const arr = reactive([1, 2, 3]);
    let runs = 0;
    const dispose = effect(() => {
      arr.length; // eslint-disable-line @typescript-eslint/no-unused-expressions
      runs++;
    });
    arr.reverse();
    flush();
    expect(runs).toBe(2);
    dispose();
  });

  it('direct index assignment triggers effects', () => {
    const arr = reactive([0, 0, 0]);
    let seen: number | undefined;
    const dispose = effect(() => {
      seen = arr[0];
    });
    expect(seen).toBe(0);
    arr[0] = 99;
    flush();
    expect(seen).toBe(99);
    dispose();
  });

  it('array inside an object is reactive', () => {
    const obj = reactive({ items: [1, 2, 3] });
    let seen = 0;
    const dispose = effect(() => {
      seen = obj.items.length;
    });
    expect(seen).toBe(3);
    obj.items.push(4);
    flush();
    expect(seen).toBe(4);
    dispose();
  });

  it('push returns the new length', () => {
    const arr = reactive<number[]>([1, 2]);
    const len = arr.push(3);
    expect(len).toBe(3);
  });

  it('pop returns the removed element', () => {
    const arr = reactive([10, 20, 30]);
    const val = arr.pop();
    expect(val).toBe(30);
  });
});
