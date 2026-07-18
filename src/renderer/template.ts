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
// Classifies each interpolation hole by scanning the static strings with a small
// HTML state machine. A hole inside a quoted, unquoted, or just-after-equals
// attribute value is an attribute hole; a hole inside an HTML comment is inert;
// a hole inside a raw text element cannot be bound at all; everything else is a
// node hole. This is robust to literal text around the hole (href="/books/${id}")
// and to multiple holes in one attribute value.
//
// The comment mode matters: without it, `<!--` is scanned as a tag, an
// apostrophe in the prose opens an attribute string that never closes, and every
// later hole in the template is misclassified as an attribute hole.
// ---------------------------------------------------------------------------

type ScanMode = 'text' | 'tag' | 'comment' | 'raw-text' | 'attr-dq' | 'attr-sq' | 'attr-unq';

interface ScanState {
  mode: ScanMode;
  afterEquals: boolean;
  /** Lowercased name of the tag being scanned, or of the open raw text element. */
  tagName: string;
  /** True when the tag being scanned is a closing tag. */
  closingTag: boolean;
}

/** How a hole is emitted into the raw HTML. */
type HoleKind = 'node' | 'attr' | 'inert' | 'raw-text';

const RAW_TEXT_FIXES = Object.create(null) as Record<string, string>;
RAW_TEXT_FIXES.textarea = 'Bind the value instead: <textarea value="${state}">.';
RAW_TEXT_FIXES.title = 'Set document.title from a controller instead.';
RAW_TEXT_FIXES.style =
  'Bind a class or a CSS custom property on the element instead, for example style="--w: ${width}".';
RAW_TEXT_FIXES.script =
  'Keep the dynamic value in TypeScript instead of writing it into a script element.';

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

// Reads the tag name starting at `start`, lowercased. Returns '' when there is
// no name there.
function readTagName(str: string, start: number): string {
  let name = '';
  for (let i = start; i < str.length; i++) {
    const ch = str[i] ?? '';
    if (!/[a-zA-Z0-9-]/u.test(ch)) break;
    name += ch;
  }
  return name.toLowerCase();
}

// Applies the '>' that ends a tag. A start tag for a raw text element opens raw
// text mode; everything else returns to text mode.
function closeTag(state: ScanState): void {
  state.afterEquals = false;
  state.mode =
    !state.closingTag && RAW_TEXT_FIXES[state.tagName] !== undefined ? 'raw-text' : 'text';
}

function scan(state: ScanState, str: string): void {
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? '';
    switch (state.mode) {
      case 'text': {
        if (ch !== '<') break;
        if (str.startsWith('<!--', i)) {
          state.mode = 'comment';
          i += 3;
          break;
        }
        const next = str[i + 1] ?? '';
        if (next === '/') {
          state.mode = 'tag';
          state.afterEquals = false;
          state.closingTag = true;
          state.tagName = readTagName(str, i + 2);
          i += 1 + state.tagName.length;
        } else if (/[a-zA-Z]/u.test(next)) {
          state.mode = 'tag';
          state.afterEquals = false;
          state.closingTag = false;
          state.tagName = readTagName(str, i + 1);
          i += state.tagName.length;
        }
        break;
      }
      case 'comment':
        if (str.startsWith('-->', i)) {
          state.mode = 'text';
          i += 2;
        }
        break;
      case 'raw-text': {
        if (ch !== '<' || (str[i + 1] ?? '') !== '/') break;
        const name = readTagName(str, i + 2);
        if (name !== state.tagName) break;
        state.mode = 'tag';
        state.closingTag = true;
        state.afterEquals = false;
        i += 1 + name.length;
        break;
      }
      case 'tag':
        if (ch === '>') {
          closeTag(state);
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
        if (ch === '>') closeTag(state);
        else if (isWhitespace(ch)) state.mode = 'tag';
        break;
    }
  }
}

function classifyHole(state: ScanState): HoleKind {
  switch (state.mode) {
    case 'comment':
      return 'inert';
    case 'raw-text':
      return 'raw-text';
    case 'attr-dq':
    case 'attr-sq':
    case 'attr-unq':
      return 'attr';
    case 'tag':
      return state.afterEquals ? 'attr' : 'node';
    case 'text':
      return 'node';
  }
}

function rawTextHoleMessage(tagName: string): string {
  const fix = RAW_TEXT_FIXES[tagName] ?? '';
  return (
    `[TypeMVC] Interpolation inside <${tagName}> is not supported because the ` +
    'element holds raw text, so the binding marker would be rendered as its content. ' +
    fix
  );
}

export function buildRawHtml(strings: TemplateStringsArray): string {
  const state: ScanState = { mode: 'text', afterEquals: false, tagName: '', closingTag: false };
  let result = strings[0] ?? '';
  scan(state, strings[0] ?? '');

  for (let i = 1; i < strings.length; i++) {
    switch (classifyHole(state)) {
      case 'attr':
        result += ATTR_SENTINEL_PREFIX + String(i - 1) + ATTR_SENTINEL_SUFFIX;
        break;
      case 'node':
        result += '<!--' + SENTINEL_PREFIX + String(i - 1) + SENTINEL_SUFFIX + '-->';
        break;
      case 'inert':
        // A hole inside an HTML comment has no binding position: a sentinel here
        // would close the author's comment early and leak the rest as text.
        break;
      case 'raw-text':
        throw new Error(rawTextHoleMessage(state.tagName));
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

// One cache per parse context. The same strings array can drive both tags when a
// tag is selected dynamically, and the two contexts parse differently (an svg
// child lands in the SVG namespace), so a single cache would serve the second
// caller the first caller's namespace.
const templateCacheByContext = {
  html: new WeakMap<TemplateStringsArray, ParsedTemplate>(),
  svg: new WeakMap<TemplateStringsArray, ParsedTemplate>(),
} as const;

/**
 * The insertion context the raw markup is parsed in. `svg` parses inside an
 * `<svg>` wrapper so that elements land in the SVG namespace, which is the only
 * way an interpolated child of an `<svg>` is a real SVG element rather than an
 * inert HTML element of the same name.
 */
export type ParseContext = 'html' | 'svg';

// Parses the raw markup and leaves template.content holding the nodes the author
// wrote. In the svg context the markup is parsed inside an <svg> wrapper, whose
// children are then hoisted out and the wrapper dropped.
function parseInto(template: HTMLTemplateElement, rawHtml: string, context: ParseContext): void {
  if (context !== 'svg') {
    template.innerHTML = rawHtml;
    return;
  }
  template.innerHTML = `<svg>${rawHtml}</svg>`;
  const wrapper = template.content.firstElementChild;
  if (wrapper === null) return;
  const content = template.content;
  let child = wrapper.firstChild;
  while (child !== null) {
    const next = child.nextSibling;
    content.insertBefore(child, wrapper);
    child = next;
  }
  content.removeChild(wrapper);
}

export function getOrParseTemplate(
  strings: TemplateStringsArray,
  context: ParseContext = 'html',
): ParsedTemplate {
  const cache = templateCacheByContext[context];
  const cached = cache.get(strings);
  if (cached !== undefined) return cached;

  const rawHtml = buildRawHtml(strings);
  const template = document.createElement('template');
  parseInto(template, rawHtml, context);

  const parsed: ParsedTemplate = {
    template,
    bindingCount: strings.length > 0 ? strings.length - 1 : 0,
  };

  cache.set(strings, parsed);
  return parsed;
}
