import { onCleanup, _hasOwner } from '../reactivity/signal.js';

/**
 * Options for {@link hotkey}.
 */
export interface HotkeyOptions {
  /**
   * When true, the handler also fires while an input, a textarea, or a
   * `contenteditable` element is focused. It defaults to false, so a hotkey does
   * not fire on a keystroke the user is typing into a field.
   */
  readonly allowInInput?: boolean;
}

/** A combo parsed into a key name and the modifier state it requires. */
interface ParsedCombo {
  readonly key: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/**
 * Reads `globalThis.document`, which is absent outside a browser, so this is a
 * genuine runtime check and not a type level one.
 */
function getDocument(): Document | null {
  const doc = (globalThis as { document?: Document }).document;
  return doc ?? null;
}

/**
 * True on an Apple platform, where `mod` resolves to the meta (Command) key
 * rather than to control. Reads the user agent so the result is stable in
 * environments without `navigator.platform`.
 */
function isApplePlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  if (nav === undefined) return false;
  const probe = (nav.platform ?? '') + ' ' + (nav.userAgent ?? '');
  return /Mac|iPhone|iPad|iPod/u.test(probe);
}

/**
 * Parses a combo such as `Escape`, `mod+k`, or `ctrl+shift+p` into the key name
 * and the modifier state it requires. `mod` maps to meta on Apple platforms and
 * to control elsewhere. Throws when the combo names no key.
 */
function parseCombo(combo: string): ParsedCombo {
  const parts = combo.split('+').map((part) => part.trim()).filter((part) => part.length > 0);
  const apple = isApplePlatform();
  let key = '';
  let meta = false;
  let ctrl = false;
  let alt = false;
  let shift = false;

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'mod':
        if (apple) meta = true;
        else ctrl = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        meta = true;
        break;
      case 'ctrl':
      case 'control':
        ctrl = true;
        break;
      case 'alt':
      case 'option':
        alt = true;
        break;
      case 'shift':
        shift = true;
        break;
      default:
        key = part.toLowerCase();
        break;
    }
  }

  if (key === '') {
    throw new Error(
      `[TypeMVC] hotkey() combo "${combo}" names no key. Write a key name, optionally with ` +
        `meta, ctrl, alt, shift or mod modifiers, for example "Escape" or "mod+k".`,
    );
  }

  return { key, meta, ctrl, alt, shift };
}

/** True when the event's key and modifier state match the parsed combo exactly. */
function matchesEvent(parsed: ParsedCombo, event: KeyboardEvent): boolean {
  if (event.metaKey !== parsed.meta) return false;
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.shiftKey !== parsed.shift) return false;
  return event.key.toLowerCase() === parsed.key;
}

/**
 * True when the event originated in an input, a textarea, or a `contenteditable`
 * element, where a bare key should not trigger a hotkey. Duck typed so it does
 * not depend on the `HTMLElement` global being present.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (el === null || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable === true;
}

/**
 * Registers a global keyboard shortcut and removes it on dispose. The combo is a
 * key name with optional `meta`, `ctrl`, `alt`, and `shift` modifiers, plus
 * `mod`, which is meta on Apple platforms and control elsewhere. By default the
 * handler does not fire while an input, a textarea, or a `contenteditable`
 * element is focused; pass `allowInInput` to opt out of that.
 *
 * Call it from a component's `@local` block, where teardown is tied to the
 * component, or from a service, where you call the returned `dispose` yourself.
 *
 * @param combo - The key combo, for example `Escape`, `mod+k`, or `ctrl+shift+p`.
 * @param handler - Called with the `KeyboardEvent` when the combo matches.
 * @param options - Optional {@link HotkeyOptions}.
 * @returns A dispose function that removes the listener. Idempotent.
 * @example
 * ```ts
 * const open = signal(false);
 * hotkey('Escape', () => open.set(false));
 * ```
 */
export function hotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options?: HotkeyOptions,
): () => void {
  const parsed = parseCombo(combo);
  const allowInInput = options?.allowInInput ?? false;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!allowInInput && isEditableTarget(event.target)) return;
    if (!matchesEvent(parsed, event)) return;
    handler(event);
  };

  const doc = getDocument();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (doc !== null) doc.removeEventListener('keydown', onKeyDown);
  };

  if (doc !== null) doc.addEventListener('keydown', onKeyDown);
  // Tie teardown to the component owner scope when there is one. Outside it (a
  // startup task's service), the caller holds the returned dispose instead.
  if (_hasOwner()) onCleanup(dispose);

  return dispose;
}
