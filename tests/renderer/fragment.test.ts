// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { Fragment } from '../../src/renderer/fragment.js';

// ---------------------------------------------------------------------------
// Failure-isolated disposal
// ---------------------------------------------------------------------------

describe('Fragment disposal failure isolation', () => {
  it('runs every teardown even when an earlier one throws', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* suppress */
    });
    const fragment = new Fragment([document.createComment('x')]);
    const ran: string[] = [];

    // Disposers run last-in first-out: c, then the throwing one, then a.
    fragment.addDispose(() => { ran.push('a'); });
    fragment.addDispose(() => { throw new Error('teardown boom'); });
    fragment.addDispose(() => { ran.push('c'); });

    fragment.dispose();

    expect(ran).toContain('a');
    expect(ran).toContain('c');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('reports a non-Error thrown by a teardown after wrapping it', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* suppress */
    });
    const fragment = new Fragment([document.createComment('x')]);
    let later = 0;

    fragment.addDispose(() => { later++; });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising a non-Error throw
    fragment.addDispose(() => { throw 'a string';  });

    fragment.dispose();

    expect(later).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Failure-isolated mounting
// ---------------------------------------------------------------------------

describe('Fragment mount failure isolation', () => {
  it('runs every mount callback even when an earlier one throws', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* suppress */
    });
    const fragment = new Fragment([document.createComment('x')]);
    const ran: string[] = [];

    fragment.addMount(() => { ran.push('a'); });
    fragment.addMount(() => { throw new Error('mount boom'); });
    fragment.addMount(() => { ran.push('c'); });

    fragment.mount();

    expect(ran).toEqual(['a', 'c']);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('reports a throwing mount callback and still keeps the others teardowns', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* suppress */
    });
    const fragment = new Fragment([document.createComment('x')]);
    let torn = 0;

    fragment.addMount(() => (): void => { torn++; });
    fragment.addMount(() => { throw new Error('mount boom'); });

    fragment.mount();
    expect(errSpy).toHaveBeenCalled();

    fragment.dispose();
    expect(torn).toBe(1);
    errSpy.mockRestore();
  });
});
