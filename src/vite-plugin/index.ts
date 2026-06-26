import type { TmvcValidationError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Source map constants
// ---------------------------------------------------------------------------

// Base64 alphabet used in V3 source map VLQ encoding
const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Lines in the generated module before .tmvc content starts (preamble lines 1-3)
const PREAMBLE_LINE_COUNT = 3;

// Column in the generated line 6 where .tmvc content begins (after "  return html`")
const TEMPLATE_START_COL = 14;

// ---------------------------------------------------------------------------
// Generated module shape constants
// ---------------------------------------------------------------------------

// Generated module preamble (lines 1-3 plus the start of line 4).
// Pure JavaScript: type annotations belong only in the Volar virtual file,
// not in the runtime module served to the browser.
const PREAMBLE_CONTEXT =
  "import { html, _callComponent } from '@typemvc/core';\n" +
  '\n' +
  'export default function render(context) {\n' +
  '  return html`';

// Component .tmvc files use `props` as the parameter so template authors write
// ${props.label} instead of ${context.label}, matching the ComponentFunction signature.
const PREAMBLE_PROPS =
  "import { html, _callComponent } from '@typemvc/core';\n" +
  '\n' +
  'export default function render(props) {\n' +
  '  return html`';

// Head of the generated module for a component that declares a @local block.
const LOCAL_PREAMBLE_HEAD =
  "import { html, _callComponent, signal, computed, effect, batch, onCleanup } from '@typemvc/core';\n" +
  '\n' +
  'export default function render(props) {\n';

// Generated module suffix: closes template literal, function, then HMR accept
const SUFFIX =
  '`;\n' +
  '}\n' +
  '\n' +
  'if (import.meta.hot) {\n' +
  '  import.meta.hot.accept();\n' +
  '}\n';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return type of transformTmvc: the generated code and its V3 source map. */
export interface TmvcTransformResult {
  readonly code: string;
  readonly map: string;
}

/**
 * Minimal Vite plugin interface (structurally compatible with vite's Plugin
 * type without requiring vite as a package dependency).
 */
export interface TmvcPlugin {
  readonly name: 'typemvc';
  readonly enforce: 'pre';
  transform(source: string, id: string): TmvcTransformResult | null;
  handleHotUpdate(ctx: {
    readonly file: string;
    readonly modules: unknown[];
  }): unknown[] | undefined;
}

// ---------------------------------------------------------------------------
// Internal parser types (shared by escapeTmvcMarkup and rewriteComponentTags)
// ---------------------------------------------------------------------------

// Discriminated union for the character-level parser state stack.
type StackEntry =
  | { readonly ctx: 'markup' }
  | { ctx: 'expr'; depth: number }
  | { readonly ctx: 'single-str' }
  | { readonly ctx: 'double-str' }
  | { readonly ctx: 'template' };

// ---------------------------------------------------------------------------
// VLQ encoder (for V3 source maps)
// ---------------------------------------------------------------------------

function encodeVlq(value: number): string {
  let encoded = '';
  // Sign-magnitude: positive values shift left; negative set LSB to 1
  let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0x20; // continuation bit
    encoded += BASE64_CHARS.charAt(digit);
  } while (vlq > 0);
  return encoded;
}

// ---------------------------------------------------------------------------
// Source map generator
// ---------------------------------------------------------------------------

// One mapped generated line: its starting column maps to (srcLine, srcCol) in
// the .tmvc source. A null entry is an unmapped generated line.
interface LineSegment {
  readonly genCol: number;
  readonly srcLine: number;
  readonly srcCol: number;
}

// Encodes one segment per generated line into a V3 mappings string.
function buildMappingsString(lineMap: readonly (LineSegment | null)[]): string {
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  const parts: string[] = [];
  for (const seg of lineMap) {
    if (seg === null) {
      parts.push('');
      continue;
    }
    parts.push(
      encodeVlq(seg.genCol) +
        encodeVlq(0) +
        encodeVlq(seg.srcLine - prevSrcLine) +
        encodeVlq(seg.srcCol - prevSrcCol),
    );
    prevSrcLine = seg.srcLine;
    prevSrcCol = seg.srcCol;
  }
  return parts.join(';');
}

function generateSourceMap(
  source: string,
  id: string,
  block: { readonly startLine: number; readonly lineCount: number } | null,
): string {
  const sourceLineCount = source.split('\n').length;
  const lineMap: (LineSegment | null)[] = [];

  // Preamble lines (import, blank, function open) have no source mapping.
  for (let i = 0; i < PREAMBLE_LINE_COUNT; i++) {
    lineMap.push(null);
  }

  // Lifted @local block lines map to the source lines they came from.
  if (block !== null) {
    for (let k = 0; k < block.lineCount; k++) {
      lineMap.push({ genCol: 0, srcLine: block.startLine + k, srcCol: 0 });
    }
  }

  // Markup maps one generated line per source line. The first markup line begins
  // at the template column (after "  return html`"); the rest at column 0.
  if (sourceLineCount > 0) {
    lineMap.push({ genCol: TEMPLATE_START_COL, srcLine: 0, srcCol: 0 });
    for (let i = 1; i < sourceLineCount; i++) {
      lineMap.push({ genCol: 0, srcLine: i, srcCol: 0 });
    }
  }

  return JSON.stringify({
    version: 3,
    file: id,
    sources: [id],
    sourcesContent: [source],
    names: [],
    mappings: buildMappingsString(lineMap),
  });
}

// ---------------------------------------------------------------------------
// @model / @props directive
// ---------------------------------------------------------------------------

/**
 * A parsed first-line directive.
 * - `model-from`: view model from a controller action's IView<T> return.
 * - `model-type`: view model from a raw TypeScript type expression.
 * - `props`: component props from a raw TypeScript type expression.
 */
export type TmvcDirective =
  | { readonly kind: 'model-from'; readonly controller: string; readonly action: string }
  | { readonly kind: 'model-type'; readonly expr: string }
  | { readonly kind: 'props'; readonly expr: string };

// Matches the first non-blank line if it is an @model or @props directive.
// Group 1 is the keyword, group 2 is the payload.
const DIRECTIVE_RE = /^[ \t]*@(model|props)[ \t]+(.+?)[ \t]*$/;
const MODEL_FROM_RE = /^from[ \t]+([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/;

/**
 * Extracts the @model/@props directive from the first non-blank line of a .tmvc
 * source and returns the body with that directive whited out (replaced by an
 * equal-length run of spaces, newline preserved). Whiting out in place keeps the
 * line count and every byte offset identical, so source maps and Volar mappings
 * require no adjustment.
 *
 * Only the first non-blank line is considered: a later directive line is left as
 * literal text here and flagged by validateTmvcSource instead.
 */
export function extractDirective(source: string): {
  body: string;
  directive: TmvcDirective | null;
} {
  const newlineIdx = source.indexOf('\n');
  // Index range of the first line (without its trailing newline).
  let lineStart = 0;
  let lineEnd = newlineIdx === -1 ? source.length : newlineIdx;
  let line = source.slice(lineStart, lineEnd);

  // Skip leading blank lines to find the first non-blank line.
  while (line.trim() === '' && lineEnd < source.length) {
    lineStart = lineEnd + 1;
    const next = source.indexOf('\n', lineStart);
    lineEnd = next === -1 ? source.length : next;
    line = source.slice(lineStart, lineEnd);
  }

  const match = DIRECTIVE_RE.exec(line);
  if (match === null) {
    return { body: source, directive: null };
  }

  const keyword = match[1] ?? '';
  const payload = match[2] ?? '';
  let directive: TmvcDirective;
  if (keyword === 'props') {
    directive = { kind: 'props', expr: payload };
  } else {
    const fromMatch = MODEL_FROM_RE.exec(payload);
    directive = fromMatch !== null
      ? { kind: 'model-from', controller: fromMatch[1] ?? '', action: fromMatch[2] ?? '' }
      : { kind: 'model-type', expr: payload };
  }

  // White out the directive line in place: same length, newline preserved.
  const blanked = ' '.repeat(lineEnd - lineStart);
  const body = source.slice(0, lineStart) + blanked + source.slice(lineEnd);

  return { body, directive };
}

// ---------------------------------------------------------------------------
// @local block extraction
// ---------------------------------------------------------------------------

/**
 * A lifted `@local` block plus the markup with the block region removed.
 * `statements` is the block body with the `@local` keyword and its braces blanked
 * out, preserving the line count so source positions stay aligned. `markup` is
 * the input body with the whole block region replaced by spaces.
 */
export interface LocalBlock {
  readonly statements: string;
  readonly markup: string;
  /** Zero-based source line of the `@local` keyword. */
  readonly startLine: number;
  /** Number of source lines the block spans. */
  readonly lineCount: number;
}

// Matches `@local` at the start of a line, allowing leading whitespace.
const LOCAL_OPEN_RE = /(?:^|\n)[ \t]*@local\b/;

/** True when the file id resolves under a components directory. */
export function isComponentPath(id: string): boolean {
  return id.replace(/\\/g, '/').includes('/components/');
}

// Returns the index of the `}` matching the `{` at openIndex, or -1 if none.
// Braces inside strings, template literals, and comments are skipped.
function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  const n = source.length;
  while (i < n) {
    const ch = source[i] ?? '';
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        const c = source[i] ?? '';
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

function countNewlines(source: string, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') count++;
  }
  return count;
}

function lineStartOffset(source: string, index: number): number {
  const nl = source.lastIndexOf('\n', index - 1);
  return nl === -1 ? 0 : nl + 1;
}

function lineEndOffset(source: string, index: number): number {
  const nl = source.indexOf('\n', index);
  return nl === -1 ? source.length : nl;
}

function blankAt(source: string, pos: number, length: number): string {
  return source.slice(0, pos) + ' '.repeat(length) + source.slice(pos + length);
}

// Replaces every character in [start, end) with a space, preserving newlines so
// the line count and every later offset are unchanged.
function blankRegion(source: string, start: number, end: number): string {
  let out = source.slice(0, start);
  for (let i = start; i < end; i++) {
    out += source[i] === '\n' ? '\n' : ' ';
  }
  return out + source.slice(end);
}

/**
 * Finds a `@local { ... }` block in a directive-stripped body and lifts it. The
 * `@local` keyword and the braces are blanked so the inner statements sit at the
 * function scope of the generated render function. Returns null when there is no
 * well formed block.
 */
export function extractLocalBlock(body: string): LocalBlock | null {
  const match = LOCAL_OPEN_RE.exec(body);
  if (match === null) return null;

  const atIndex = body.indexOf('@local', match.index);
  if (atIndex === -1) return null;

  // Only whitespace may sit between `@local` and the opening brace.
  let i = atIndex + '@local'.length;
  while (i < body.length && /\s/.test(body[i] ?? '')) i++;
  if (body[i] !== '{') return null;

  const openBrace = i;
  const closeBrace = findMatchingBrace(body, openBrace);
  if (closeBrace === -1) return null;

  const startLine = countNewlines(body, atIndex);
  const endLine = countNewlines(body, closeBrace);
  const lineCount = endLine - startLine + 1;

  const regionStart = lineStartOffset(body, atIndex);
  const regionEnd = lineEndOffset(body, closeBrace);
  let statements = body.slice(regionStart, regionEnd);
  statements = blankAt(statements, atIndex - regionStart, '@local'.length);
  statements = blankAt(statements, openBrace - regionStart, 1);
  statements = blankAt(statements, closeBrace - regionStart, 1);

  const markup = blankRegion(body, atIndex, closeBrace + 1);

  return { statements, markup, startLine, lineCount };
}

// ---------------------------------------------------------------------------
// Forbidden-pattern validator
// ---------------------------------------------------------------------------

/**
 * Validates .tmvc source for forbidden top-level constructs and, when an `id` is
 * supplied, for `@local` block rules. Returns a list of errors; an empty array
 * means the source is valid.
 *
 * @param source - The raw .tmvc source.
 * @param id - The file id, used to enforce that `@local` is component only. When
 *   omitted (the zero-build runtime parser), the component check is skipped but
 *   the in-block denylist still applies.
 */
export function validateTmvcSource(source: string, id?: string): TmvcValidationError[] {
  const normalized = source.replace(/\r\n/g, '\n');
  const errors: TmvcValidationError[] = [];

  // Locate a @local block so its lines are validated against the denylist rather
  // than the markup rules, and so it can be flagged when it appears in a view.
  const localBlock = extractLocalBlock(normalized);
  const blockFirstLine = localBlock !== null ? localBlock.startLine : -1;
  const blockLastLine =
    localBlock !== null ? localBlock.startLine + localBlock.lineCount - 1 : -1;

  // Parser state stack: tracks whether we are in markup, expression, or string
  const stack: StackEntry[] = [{ ctx: 'markup' }];
  // lineStartsInMarkup[i] = true if line i+1 (1-indexed) starts in markup context
  const lineStartsInMarkup: boolean[] = [];
  let lineStart = true;
  const n = normalized.length;

  for (let i = 0; i < n; i++) {
    const ch = normalized[i] ?? '';
    const next = normalized[i + 1] ?? '';
    const top = stack.at(-1);
    if (top === undefined) break;

    if (lineStart) {
      lineStartsInMarkup.push(top.ctx === 'markup');
      lineStart = false;
    }

    if (ch === '\n') {
      lineStart = true;
      continue;
    }

    // In string-like contexts, backslash escapes the next character
    if (
      (top.ctx === 'single-str' ||
        top.ctx === 'double-str' ||
        top.ctx === 'template') &&
      ch === '\\'
    ) {
      i++;
      continue;
    }

    switch (top.ctx) {
      case 'markup':
        if (ch === '$' && next === '{') {
          stack.push({ ctx: 'expr', depth: 1 });
          i++;
        }
        break;

      case 'expr':
        if (ch === '"') {
          stack.push({ ctx: 'double-str' });
        } else if (ch === "'") {
          stack.push({ ctx: 'single-str' });
        } else if (ch === '`') {
          stack.push({ ctx: 'template' });
        } else if (ch === '{') {
          top.depth++;
        } else if (ch === '}') {
          top.depth--;
          if (top.depth === 0) stack.pop();
        }
        break;

      case 'single-str':
        if (ch === "'") stack.pop();
        break;

      case 'double-str':
        if (ch === '"') stack.pop();
        break;

      case 'template':
        if (ch === '`') {
          stack.pop();
        } else if (ch === '$' && next === '{') {
          stack.push({ ctx: 'expr', depth: 1 });
          i++;
        }
        break;
    }
  }

  // Check each line that starts in markup text for forbidden constructs
  const lines = normalized.split('\n');
  // The @model directive is only valid as the first non-blank line. Track that
  // index so any later @model line, or a duplicate, can be flagged.
  const firstNonBlankIdx = lines.findIndex((l) => l.trim() !== '');
  for (let i = 0; i < lines.length; i++) {
    // Block lines are TypeScript, not markup; they are checked separately below.
    if (i >= blockFirstLine && i <= blockLastLine) continue;
    if (!(lineStartsInMarkup[i] ?? true)) continue;
    const line = lines[i] ?? '';
    const lineNum = i + 1;

    if (/^\s*import\s/.test(line)) {
      errors.push({ kind: 'import-statement', line: lineNum, source: line });
    } else if (/^\s*export\s/.test(line)) {
      errors.push({ kind: 'export-statement', line: lineNum, source: line });
    } else if (/^\s*(abstract\s+)?class\s/.test(line)) {
      errors.push({ kind: 'class-definition', line: lineNum, source: line });
    } else if (/^\s*@(model|props)\b/.test(line) && i !== firstNonBlankIdx) {
      errors.push({ kind: 'invalid-model-directive', line: lineNum, source: line });
    }
  }

  // @local block rules: components only, and a domain/IO denylist inside.
  if (localBlock !== null) {
    if (id !== undefined && !isComponentPath(id)) {
      errors.push({
        kind: 'local-in-view',
        line: blockFirstLine + 1,
        source: lines[blockFirstLine] ?? '',
      });
    }
    for (let i = blockFirstLine; i <= blockLastLine; i++) {
      const line = lines[i] ?? '';
      const lineNum = i + 1;
      if (/\bimport\b/.test(line)) {
        errors.push({ kind: 'local-import', line: lineNum, source: line });
      }
      if (/\bexport\b/.test(line)) {
        errors.push({ kind: 'local-export', line: lineNum, source: line });
      }
      if (/\b(?:async|await)\b/.test(line)) {
        errors.push({ kind: 'local-async', line: lineNum, source: line });
      }
      if (/\bfetch\b/.test(line)) {
        errors.push({ kind: 'local-fetch', line: lineNum, source: line });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Markup backtick escaper
// ---------------------------------------------------------------------------

// Escapes bare backticks in markup text so they do not terminate the outer
// tagged template literal in the generated module. Backticks inside ${...}
// expressions are part of nested template literals and are left untouched.
export function escapeTmvcMarkup(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  const stack: StackEntry[] = [{ ctx: 'markup' }];
  let result = '';
  const n = normalized.length;

  for (let i = 0; i < n; i++) {
    const ch = normalized[i] ?? '';
    const next = normalized[i + 1] ?? '';
    const top = stack.at(-1);
    if (top === undefined) break;

    // In string-like contexts, propagate escape sequences verbatim
    if (
      (top.ctx === 'single-str' ||
        top.ctx === 'double-str' ||
        top.ctx === 'template') &&
      ch === '\\'
    ) {
      result += ch + (normalized[i + 1] ?? '');
      i++;
      continue;
    }

    switch (top.ctx) {
      case 'markup':
        if (ch === '`') {
          result += '\\`'; // escape bare backtick
        } else if (ch === '$' && next === '{') {
          result += '${';
          stack.push({ ctx: 'expr', depth: 1 });
          i++;
        } else {
          result += ch;
        }
        break;

      case 'expr':
        if (ch === '"') {
          stack.push({ ctx: 'double-str' });
          result += ch;
        } else if (ch === "'") {
          stack.push({ ctx: 'single-str' });
          result += ch;
        } else if (ch === '`') {
          stack.push({ ctx: 'template' });
          result += ch;
        } else if (ch === '{') {
          top.depth++;
          result += ch;
        } else if (ch === '}') {
          top.depth--;
          if (top.depth === 0) stack.pop();
          result += ch;
        } else {
          result += ch;
        }
        break;

      case 'single-str':
        if (ch === "'") stack.pop();
        result += ch;
        break;

      case 'double-str':
        if (ch === '"') stack.pop();
        result += ch;
        break;

      case 'template':
        if (ch === '`') {
          stack.pop();
          result += ch;
        } else if (ch === '$' && next === '{') {
          stack.push({ ctx: 'expr', depth: 1 });
          result += '${';
          i++;
        } else {
          result += ch;
        }
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component tag rewriter
// ---------------------------------------------------------------------------

// Internal attribute representation produced by parseComponentTag.
interface AttrProp {
  readonly name: string;
  readonly kind: 'boolean' | 'static' | 'expr' | 'template';
  readonly value: string;
}

// Scans from the character after '${' to the matching '}', correctly tracking
// nested brackets, string literals, and template literals inside the expression.
// Returns the expression content (between '${' and '}') and the index after '}'.
function scanExpression(
  source: string,
  start: number,
): { content: string; end: number } | null {
  const n = source.length;
  let i = start;
  let depth = 1;

  while (i < n) {
    const ch = source[i] ?? '';

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < n) {
        const sc = source[i] ?? '';
        if (sc === '\\') { i += 2; continue; }
        if (sc === q) { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === '`') {
      i++;
      while (i < n) {
        const tc = source[i] ?? '';
        if (tc === '\\') { i += 2; continue; }
        if (tc === '`') { i++; break; }
        if (tc === '$' && (source[i + 1] ?? '') === '{') {
          i += 2;
          let nd = 1;
          while (i < n && nd > 0) {
            const nc = source[i] ?? '';
            if (nc === '{') nd++;
            else if (nc === '}') {
              nd--;
              if (nd === 0) { i++; break; }
            }
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }

    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { content: source.slice(start, i), end: i + 1 };
      }
      i++;
      continue;
    }

    i++;
  }

  return null;
}

// Builds the ${_callComponent(...)} expression string for a parsed component tag.
// extraProps are pre-built `name: expr` entries for the default `children` slot
// and any named slots, appended after the attribute props.
function buildComponentExpr(
  tagName: string,
  attrs: AttrProp[],
  extraProps: string[] = [],
): string {
  const props = attrs.map((attr) => {
    switch (attr.kind) {
      case 'boolean':
        return `${attr.name}: true`;
      case 'static':
        return `${attr.name}: ${JSON.stringify(attr.value)}`;
      case 'expr':
        return `${attr.name}: ${attr.value}`;
      case 'template':
        return `${attr.name}: \`${attr.value.replace(/`/gu, '\\`')}\``;
    }
  });
  props.push(...extraProps);
  if (props.length === 0) {
    return `\${_callComponent('${tagName}', {})}`;
  }
  return `\${_callComponent('${tagName}', { ${props.join(', ')} })}`;
}

// Matches a named slot opening tag <slot:name> at the start of a string.
const SLOT_OPEN_RE = /^<slot:([A-Za-z_$][\w$]*)\s*>/u;

// Finds the matching </slot:name> from `start`, skipping ${...} expressions and
// nested component spans so they cannot terminate the slot early. Returns the
// content end (index of '<' of the close tag) and the index past the close tag.
function findSlotClose(
  source: string,
  start: number,
  name: string,
): { contentEnd: number; end: number } | null {
  const closeTag = `</slot:${name}>`;
  const n = source.length;
  let i = start;

  while (i < n) {
    const ch = source[i] ?? '';
    if (ch === '$' && (source[i + 1] ?? '') === '{') {
      const expr = scanExpression(source, i + 2);
      if (expr === null) return null;
      i = expr.end;
      continue;
    }
    if (ch === '<') {
      if (source.slice(i, i + closeTag.length) === closeTag) {
        return { contentEnd: i, end: i + closeTag.length };
      }
      if (/[A-Z]/u.test(source[i + 1] ?? '')) {
        const nested = parseComponentTag(source, i);
        if (nested !== null) {
          i = nested.end;
          continue;
        }
      }
    }
    i++;
  }
  return null;
}

// Splits a component's raw children into named <slot:name> regions plus the
// default (unnamed) content. ${...} expressions and nested component spans are
// skipped so a slot tag inside them, or inside a nested component, is not
// mistaken for a direct slot of this component.
function splitSlots(childrenRaw: string): {
  slots: { name: string; body: string }[];
  defaultContent: string;
} {
  const n = childrenRaw.length;
  const slots: { name: string; body: string }[] = [];
  let def = '';
  let i = 0;

  while (i < n) {
    const ch = childrenRaw[i] ?? '';

    if (ch === '$' && (childrenRaw[i + 1] ?? '') === '{') {
      const expr = scanExpression(childrenRaw, i + 2);
      if (expr === null) {
        def += childrenRaw.slice(i);
        break;
      }
      def += childrenRaw.slice(i, expr.end);
      i = expr.end;
      continue;
    }

    if (ch === '<') {
      const open = SLOT_OPEN_RE.exec(childrenRaw.slice(i));
      if (open !== null) {
        const name = open[1] ?? '';
        const bodyStart = i + open[0].length;
        const close = findSlotClose(childrenRaw, bodyStart, name);
        if (close !== null) {
          slots.push({ name, body: childrenRaw.slice(bodyStart, close.contentEnd) });
          i = close.end;
          continue;
        }
      }
      // Skip nested component spans so their inner slots are not pulled up.
      if (/[A-Z]/u.test(childrenRaw[i + 1] ?? '')) {
        const nested = parseComponentTag(childrenRaw, i);
        if (nested !== null) {
          def += childrenRaw.slice(i, nested.end);
          i = nested.end;
          continue;
        }
      }
    }

    def += ch;
    i++;
  }

  return { slots, defaultContent: def };
}

// Scans the children of a paired component tag, starting at `start` (the index
// immediately after the opening tag's '>'). Returns the raw children substring
// and the index just past the matching '</TagName>'. ${...} expressions and
// nested component tags are skipped as opaque spans so their '<', '>', and
// close tags cannot be mistaken for the boundary. Returns null when no matching
// close tag is found.
function scanComponentChildren(
  source: string,
  start: number,
  tagName: string,
): { childrenRaw: string; end: number } | null {
  const n = source.length;
  const closeOpen = `</${tagName}`;
  let i = start;

  while (i < n) {
    const ch = source[i] ?? '';

    // Skip ${...} expressions wholesale so their contents never affect matching.
    if (ch === '$' && (source[i + 1] ?? '') === '{') {
      const expr = scanExpression(source, i + 2);
      if (expr === null) return null;
      i = expr.end;
      continue;
    }

    if (ch === '<') {
      // Our closing tag: </TagName> with optional whitespace before '>'.
      if (source.slice(i, i + closeOpen.length) === closeOpen) {
        const boundary = source[i + closeOpen.length] ?? '';
        if (boundary === '>' || /\s/u.test(boundary)) {
          let k = i + closeOpen.length;
          while (k < n && /\s/u.test(source[k] ?? '')) k++;
          if ((source[k] ?? '') === '>') {
            return { childrenRaw: source.slice(start, i), end: k + 1 };
          }
        }
      }
      // A nested PascalCase component: consume its whole span (including its own
      // children) so a same-name nested tag cannot close us prematurely.
      if (/[A-Z]/u.test(source[i + 1] ?? '')) {
        const nested = parseComponentTag(source, i);
        if (nested !== null) {
          i = nested.end;
          continue;
        }
      }
    }

    i++;
  }

  return null;
}

// Attempts to parse a PascalCase component tag starting at position `start`
// (which must point to '<'). Returns the generated expression and the index
// after the closing '/>' or '</TagName>', or null if the tag cannot be parsed
// (e.g. non-empty children, malformed syntax).
function parseComponentTag(
  source: string,
  start: number,
): { output: string; end: number } | null {
  const n = source.length;
  let i = start + 1; // skip '<'

  // Read the tag name: must start with an uppercase letter
  let tagName = '';
  while (i < n && /\w/u.test(source[i] ?? '')) {
    tagName += source[i] ?? '';
    i++;
  }
  if (tagName.length === 0 || !/^[A-Z]/u.test(tagName)) return null;

  const attrs: AttrProp[] = [];

  while (i < n) {
    // Skip whitespace between attributes
    while (i < n && /\s/u.test(source[i] ?? '')) i++;

    const ch = source[i] ?? '';

    // Self-closing tag
    if (ch === '/' && (source[i + 1] ?? '') === '>') {
      return { output: buildComponentExpr(tagName, attrs), end: i + 2 };
    }

    // Opening '>' for a paired tag: capture children up to the matching close.
    if (ch === '>') {
      i++;
      const scanned = scanComponentChildren(source, i, tagName);
      if (scanned === null) return null;

      // Split into named <slot:name> regions plus the default content. Each
      // slot body and the default content are recursively rewritten and escaped
      // so they survive embedding as nested html`` Fragment props. Named slots
      // become `name: html\`...\`` props; default content becomes `children`.
      const { slots, defaultContent } = splitSlots(scanned.childrenRaw);
      const extraProps: string[] = [];
      for (const slot of slots) {
        const processed = escapeTmvcMarkup(rewriteComponentTags(slot.body));
        extraProps.push(`${slot.name}: html\`${processed}\``);
      }
      if (defaultContent.trim() !== '') {
        const processed = escapeTmvcMarkup(rewriteComponentTags(defaultContent));
        extraProps.push('children: html`' + processed + '`');
      }
      return {
        output: buildComponentExpr(tagName, attrs, extraProps),
        end: scanned.end,
      };
    }

    // Must be the start of an attribute name
    if (ch === '' || ch === '<' || !/[a-zA-Z_]/u.test(ch)) return null;

    // Read attribute name (alphanumeric, hyphens, underscores)
    let attrName = '';
    while (i < n && /[a-zA-Z0-9_-]/u.test(source[i] ?? '')) {
      attrName += source[i] ?? '';
      i++;
    }
    if (attrName.length === 0) return null;

    // Skip inline whitespace before '='
    while (i < n && /[ \t]/u.test(source[i] ?? '')) i++;

    const eq = source[i] ?? '';
    if (eq !== '=') {
      // Boolean attribute (no value)
      attrs.push({ name: attrName, kind: 'boolean', value: '' });
      continue;
    }
    i++; // skip '='

    const quote = source[i] ?? '';
    if (quote !== '"' && quote !== "'") return null; // malformed
    i++; // skip opening quote

    // Parse the attribute value, collecting text and ${expr} segments
    const segments: { kind: 'text' | 'expr'; content: string }[] = [];
    let textBuf = '';

    while (i < n) {
      const vc = source[i] ?? '';

      if (vc === '\\') {
        textBuf += vc + (source[i + 1] ?? '');
        i += 2;
        continue;
      }

      if (vc === quote) {
        // End of attribute value
        if (textBuf.length > 0) segments.push({ kind: 'text', content: textBuf });
        i++;
        break;
      }

      if (vc === '$' && (source[i + 1] ?? '') === '{') {
        if (textBuf.length > 0) {
          segments.push({ kind: 'text', content: textBuf });
          textBuf = '';
        }
        i += 2; // skip '${'
        const exprResult = scanExpression(source, i);
        if (exprResult === null) return null;
        segments.push({ kind: 'expr', content: exprResult.content });
        i = exprResult.end;
        continue;
      }

      textBuf += vc;
      i++;
    }

    // Classify the collected segments into the appropriate AttrProp kind
    const seg0 = segments[0];
    if (segments.length === 0) {
      attrs.push({ name: attrName, kind: 'static', value: '' });
    } else if (segments.length === 1 && seg0?.kind === 'text') {
      attrs.push({ name: attrName, kind: 'static', value: seg0.content });
    } else if (segments.length === 1 && seg0?.kind === 'expr') {
      attrs.push({ name: attrName, kind: 'expr', value: seg0.content });
    } else {
      // Mixed text and expressions: produce a template literal
      const raw = segments
        .map((s) => (s.kind === 'text' ? s.content : '${' + s.content + '}'))
        .join('');
      attrs.push({ name: attrName, kind: 'template', value: raw });
    }
  }

  return null; // tag not terminated
}

/**
 * Rewrites PascalCase component tags in .tmvc markup into
 * ${_callComponent('TagName', { prop: value })} expressions.
 *
 * Operates on both top-level markup context and on template literal contexts
 * inside ${...} expressions (covering nested html`` calls in .map() callbacks).
 * Component tags inside JS string literals are correctly left untouched.
 *
 * Only self-closing tags (<Tag />) and empty paired tags (<Tag></Tag>) are
 * transformed. Paired tags with non-empty children are left as-is (phase 1).
 */
export function rewriteComponentTags(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  const n = normalized.length;
  const stack: StackEntry[] = [{ ctx: 'markup' }];
  let result = '';
  let i = 0;

  while (i < n) {
    const ch = normalized[i] ?? '';
    const top = stack[stack.length - 1];
    if (top === undefined) break;

    // Escape sequences in string-like contexts: propagate verbatim
    if (
      (top.ctx === 'single-str' ||
        top.ctx === 'double-str' ||
        top.ctx === 'template') &&
      ch === '\\'
    ) {
      result += ch + (normalized[i + 1] ?? '');
      i += 2;
      continue;
    }

    if (top.ctx === 'markup' || top.ctx === 'template') {
      // Check for PascalCase component tag
      if (ch === '<' && /[A-Z]/u.test(normalized[i + 1] ?? '')) {
        const tagResult = parseComponentTag(normalized, i);
        if (tagResult !== null) {
          result += tagResult.output;
          i = tagResult.end;
          continue;
        }
      }

      // Pop template context on closing backtick
      if (top.ctx === 'template' && ch === '`') {
        stack.pop();
        result += ch;
        i++;
        continue;
      }

      // Enter expression context on '${'
      if (ch === '$' && (normalized[i + 1] ?? '') === '{') {
        stack.push({ ctx: 'expr', depth: 1 });
        result += '${';
        i += 2;
        continue;
      }

      result += ch;
      i++;
      continue;
    }

    if (top.ctx === 'expr') {
      if (ch === '"') {
        stack.push({ ctx: 'double-str' });
      } else if (ch === "'") {
        stack.push({ ctx: 'single-str' });
      } else if (ch === '`') {
        stack.push({ ctx: 'template' });
      } else if (ch === '{') {
        top.depth++;
      } else if (ch === '}') {
        top.depth--;
        if (top.depth === 0) stack.pop();
      }
      result += ch;
      i++;
      continue;
    }

    // single-str or double-str: scan for closing quote
    if (top.ctx === 'single-str' && ch === "'") stack.pop();
    else if (top.ctx === 'double-str' && ch === '"') stack.pop();
    result += ch;
    i++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Code generator
// ---------------------------------------------------------------------------

/**
 * Transforms .tmvc source into a Phase 1-compatible TypeScript module with
 * an accurate V3 source map.
 */
export function transformTmvc(
  source: string,
  id: string,
): TmvcTransformResult {
  // The @model/@props directive is a Volar-only type hint; strip it (whited out
  // in place so the source map stays byte-accurate) before generating runtime JS.
  const { body } = extractDirective(source);
  const isComponent = isComponentPath(id);

  // A @local block lifts to component-scope statements; views never have one.
  const localBlock = isComponent ? extractLocalBlock(body) : null;
  const markupBody = localBlock !== null ? localBlock.markup : body;

  const rewritten = rewriteComponentTags(markupBody);
  const escaped = escapeTmvcMarkup(rewritten);

  let code: string;
  if (localBlock !== null) {
    code = LOCAL_PREAMBLE_HEAD + localBlock.statements + '\n  return html`' + escaped + SUFFIX;
  } else {
    const preamble = isComponent ? PREAMBLE_PROPS : PREAMBLE_CONTEXT;
    code = preamble + escaped + SUFFIX;
  }

  const block = localBlock !== null
    ? { startLine: localBlock.startLine, lineCount: localBlock.lineCount }
    : null;
  const map = generateSourceMap(source, id, block);
  return { code, map };
}

// ---------------------------------------------------------------------------
// Error description helpers
// ---------------------------------------------------------------------------

export function describeValidationError(err: TmvcValidationError): string {
  switch (err.kind) {
    case 'import-statement':
      return 'import declarations are not permitted. Use the implicit context and html bindings instead.';
    case 'export-statement':
      return 'export declarations are not permitted. The default export is generated by the framework.';
    case 'class-definition':
      return 'class definitions are not permitted. Views are pure templates.';
    case 'invalid-model-directive':
      return 'the @model directive must be the first non-blank line of the view, and may appear only once.';
    case 'local-in-view':
      return 'the @local block is only allowed in component files. Move local state into a component, or move this logic to a controller.';
    case 'local-import':
      return 'import is not allowed in @local. A component declares no module dependencies; pass what you need as a prop.';
    case 'local-export':
      return 'export is not allowed in @local. The component default export is generated by the framework.';
    case 'local-async':
      return 'async and await are not allowed in @local. Move data loading to a controller and pass the result as a prop.';
    case 'local-fetch':
      return 'fetch is not allowed in @local. Move data loading to a controller and pass the result as a prop.';
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Creates the TypeMVC Vite plugin that transforms .tmvc view files at build
 * time into Phase 1-compatible TypeScript modules.
 */
export function typemvcPlugin(): TmvcPlugin {
  return {
    name: 'typemvc',
    enforce: 'pre',

    transform(
      source: string,
      id: string,
    ): TmvcTransformResult | null {
      if (!id.endsWith('.tmvc')) return null;

      const errors = validateTmvcSource(source, id);
      if (errors.length > 0) {
        const first = errors[0];
        if (first === undefined) return null;
        throw new Error(
          `[TypeMVC] .tmvc transform error at line ${String(first.line)}: ` +
            describeValidationError(first),
        );
      }

      return transformTmvc(source, id);
    },

    handleHotUpdate(ctx: {
      readonly file: string;
      readonly modules: unknown[];
    }): unknown[] | undefined {
      if (!ctx.file.endsWith('.tmvc')) return undefined;
      return ctx.modules;
    },
  };
}
