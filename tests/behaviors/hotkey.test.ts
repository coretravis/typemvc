// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hotkey } from '../../src/behaviors/hotkey.js';
import { _withOwner } from '../../src/reactivity/signal.js';

// hotkey() registers teardown with onCleanup, which warns when called outside a
// component owner scope. Suppress that here; the hotkey behaviour is what these
// tests assert on.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

interface KeyInit {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

function press(init: KeyInit, target: EventTarget = document): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('hotkey: matching', () => {
  it('fires on the combo and not on other keys', () => {
    const fn = vi.fn();
    hotkey('Escape', fn);
    press({ key: 'Escape' });
    expect(fn).toHaveBeenCalledTimes(1);
    press({ key: 'Enter' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('requires the exact modifier state', () => {
    const fn = vi.fn();
    hotkey('k', fn);
    press({ key: 'k', ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
    press({ key: 'k' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws for a combo that names no key', () => {
    expect(() => hotkey('ctrl+', vi.fn())).toThrow('[TypeMVC]');
  });
});

describe('hotkey: modifiers and mod', () => {
  it('matches an explicit modifier combo', () => {
    const fn = vi.fn();
    hotkey('ctrl+shift+p', fn);
    press({ key: 'p', ctrlKey: true, shiftKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    press({ key: 'p', ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maps mod to meta on an Apple platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    const fn = vi.fn();
    hotkey('mod+k', fn);
    press({ key: 'k', metaKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    press({ key: 'k', ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maps mod to ctrl off an Apple platform', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT' });
    const fn = vi.fn();
    hotkey('mod+k', fn);
    press({ key: 'k', ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
    press({ key: 'k', metaKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('hotkey: editable targets', () => {
  it('does not fire on a keystroke typed into an input by default', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const fn = vi.fn();
    hotkey('Escape', fn);
    press({ key: 'Escape' }, input);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fire in a textarea or a contenteditable by default', () => {
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(textarea, editable);
    const fn = vi.fn();
    hotkey('Escape', fn);
    press({ key: 'Escape' }, textarea);
    press({ key: 'Escape' }, editable);
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires in an input when allowInInput is set', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const fn = vi.fn();
    hotkey('Escape', fn, { allowInInput: true });
    press({ key: 'Escape' }, input);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('hotkey: disposal and independence', () => {
  it('removes the listener on dispose so a disposed hotkey does not fire', () => {
    const fn = vi.fn();
    const dispose = hotkey('Escape', fn);
    dispose();
    press({ key: 'Escape' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('registers teardown with onCleanup so the owner scope disposes it', () => {
    const fn = vi.fn();
    const { disposes } = _withOwner(() => {
      hotkey('Escape', fn);
    });
    for (const dispose of disposes) dispose();
    press({ key: 'Escape' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('lets two hotkeys on the same combo both fire, and disposing one keeps the other', () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = hotkey('Escape', first);
    hotkey('Escape', second);

    press({ key: 'Escape' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    disposeFirst();
    press({ key: 'Escape' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
