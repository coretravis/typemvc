export interface ParsedTemplate {
  readonly template: HTMLTemplateElement;
  readonly bindingCount: number;
}

const SENTINEL_PREFIX = '__tmvc_b';
const SENTINEL_SUFFIX = '__';
export const ATTR_SENTINEL_PREFIX = '__tmvc_ba';
export const ATTR_SENTINEL_SUFFIX = '__';

// ---------------------------------------------------------------------------
// HTML position scanner
//
// Classifies each interpolation hole as a node hole or an attribute hole by
// scanning the static strings with a small HTML state machine. A hole inside a
// quoted, unquoted, or just-after-equals attribute value is an attribute hole;
// everything else is a node hole. This is robust to literal text around the
// hole (href="/books/${id}") and to multiple holes in one attribute value.
// ---------------------------------------------------------------------------

type ScanMode = 'text' | 'tag' | 'attr-dq' | 'attr-sq' | 'attr-unq';

interface ScanState {
  mode: ScanMode;
  afterEquals: boolean;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function scan(state: ScanState, str: string): void {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? '';
    switch (state.mode) {
      case 'text':
        if (ch === '<' && /[a-zA-Z/!]/u.test(str[i + 1] ?? '')) {
          state.mode = 'tag';
          state.afterEquals = false;
        }
        break;
      case 'tag':
        if (ch === '>') {
          state.mode = 'text';
          state.afterEquals = false;
        } else if (ch === '"') {
          state.mode = 'attr-dq';
          state.afterEquals = false;
        } else if (ch === "'") {
          state.mode = 'attr-sq';
          state.afterEquals = false;
        } else if (ch === '=') {
          state.afterEquals = true;
        } else if (!isWhitespace(ch)) {
          if (state.afterEquals) {
            state.mode = 'attr-unq';
            state.afterEquals = false;
          }
        }
        break;
      case 'attr-dq':
        if (ch === '"') state.mode = 'tag';
        break;
      case 'attr-sq':
        if (ch === "'") state.mode = 'tag';
        break;
      case 'attr-unq':
        if (ch === '>') state.mode = 'text';
        else if (isWhitespace(ch)) state.mode = 'tag';
        break;
    }
  }
}

function isAttributeHole(state: ScanState): boolean {
  return (
    state.mode === 'attr-dq' ||
    state.mode === 'attr-sq' ||
    state.mode === 'attr-unq' ||
    (state.mode === 'tag' && state.afterEquals)
  );
}

export function buildRawHtml(strings: TemplateStringsArray): string {
  const state: ScanState = { mode: 'text', afterEquals: false };
  let result = strings[0] ?? '';
  scan(state, strings[0] ?? '');

  for (let i = 1; i < strings.length; i++) {
    if (isAttributeHole(state)) {
      result += ATTR_SENTINEL_PREFIX + String(i - 1) + ATTR_SENTINEL_SUFFIX;
    } else {
      result += '<!--' + SENTINEL_PREFIX + String(i - 1) + SENTINEL_SUFFIX + '-->';
    }
    const next = strings[i] ?? '';
    result += next;
    scan(state, next);
  }
  return result;
}

export function parseSentinelIndex(data: string): number | null {
  if (!data.startsWith(SENTINEL_PREFIX)) return null;
  const rest = data.slice(SENTINEL_PREFIX.length);
  if (!rest.endsWith(SENTINEL_SUFFIX)) return null;
  const inner = rest.slice(0, rest.length - SENTINEL_SUFFIX.length);
  const index = Number(inner);
  return Number.isNaN(index) ? null : index;
}

// ---------------------------------------------------------------------------
// Attribute value parts
//
// An interpolated attribute value is split into ordered parts: literal text and
// hole references. A value with no holes returns null (a plain static
// attribute). Holes may appear anywhere and more than once in one value.
// ---------------------------------------------------------------------------

export type AttrPart =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'hole'; readonly index: number };

const ATTR_TOKEN_RE = /__tmvc_ba(\d+)__/gu;

export function splitAttrValue(value: string): AttrPart[] | null {
  ATTR_TOKEN_RE.lastIndex = 0;
  let match = ATTR_TOKEN_RE.exec(value);
  if (match === null) return null;

  const parts: AttrPart[] = [];
  let last = 0;
  while (match !== null) {
    if (match.index > last) {
      parts.push({ kind: 'literal', text: value.slice(last, match.index) });
    }
    parts.push({ kind: 'hole', index: Number(match[1]) });
    last = match.index + match[0].length;
    match = ATTR_TOKEN_RE.exec(value);
  }
  if (last < value.length) {
    parts.push({ kind: 'literal', text: value.slice(last) });
  }
  return parts;
}

const templateCache = new WeakMap<TemplateStringsArray, ParsedTemplate>();

export function getOrParseTemplate(strings: TemplateStringsArray): ParsedTemplate {
  const cached = templateCache.get(strings);
  if (cached !== undefined) return cached;

  const rawHtml = buildRawHtml(strings);
  const template = document.createElement('template');
  template.innerHTML = rawHtml;

  const parsed: ParsedTemplate = {
    template,
    bindingCount: strings.length > 0 ? strings.length - 1 : 0,
  };

  templateCache.set(strings, parsed);
  return parsed;
}
