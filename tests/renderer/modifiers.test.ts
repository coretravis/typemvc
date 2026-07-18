// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { prevent, stop } from '../../src/renderer/modifiers.js';

// ---------------------------------------------------------------------------
// AC5: prevent(fn)
// ---------------------------------------------------------------------------

describe('prevent(fn)', () => {
  it('calls e.preventDefault() before the handler', () => {
    const handler = vi.fn();
    const event = new Event('submit', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    prevent(handler)(event);

    expect(preventDefaultSpy).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('calls preventDefault before the handler (order enforced)', () => {
    const order: string[] = [];
    const event = new Event('submit', { cancelable: true });
    vi.spyOn(event, 'preventDefault').mockImplementation(() => { order.push('prevent'); });
    const handler = vi.fn().mockImplementation(() => { order.push('handler'); });

    prevent(handler)(event);

    expect(order).toEqual(['prevent', 'handler']);
  });

  it('passes the event to the original handler', () => {
    const handler = vi.fn();
    const event = new MouseEvent('click');

    prevent(handler)(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('returns a function', () => {
    expect(typeof prevent(vi.fn())).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC6: stop(fn)
// ---------------------------------------------------------------------------

describe('stop(fn)', () => {
  it('calls e.stopPropagation() before the handler', () => {
    const handler = vi.fn();
    const event = new Event('click', { bubbles: true });
    const stopSpy = vi.spyOn(event, 'stopPropagation');

    stop(handler)(event);

    expect(stopSpy).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('calls stopPropagation before the handler (order enforced)', () => {
    const order: string[] = [];
    const event = new Event('click', { bubbles: true });
    vi.spyOn(event, 'stopPropagation').mockImplementation(() => { order.push('stop'); });
    const handler = vi.fn().mockImplementation(() => { order.push('handler'); });

    stop(handler)(event);

    expect(order).toEqual(['stop', 'handler']);
  });

  it('passes the event to the original handler', () => {
    const handler = vi.fn();
    const event = new KeyboardEvent('keydown');

    stop(handler)(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('returns a function', () => {
    expect(typeof stop(vi.fn())).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// AC7: barrel re-export (checked via public index)
// ---------------------------------------------------------------------------

describe('barrel export (AC7)', () => {
  it('prevent and stop are exported from the public barrel', async () => {
    const barrel = await import('../../src/index.js');
    expect(typeof barrel.prevent).toBe('function');
    expect(typeof barrel.stop).toBe('function');
  });
});
