import { existsSync, readFileSync } from 'node:fs';
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
// A view is a derivation of the model it was handed, so it gets `computed`, but
// not `signal` or `effect`: owning new state is what a component `@local` block
// is for. The remaining names are output helpers a template needs to build
// derived, keyed, or trusted markup.
const PREAMBLE_CONTEXT =
  "import { html, svg, _callComponent, computed, keyed, keyedMap, safeHtml, stop, prevent } from '@typemvc/core';\n" +
  '\n' +
  'export default function render(context) {\n' +
  '  return html`';

// Component .tmvc files use `props` as the parameter so template authors write
// ${props.label} instead of ${context.label}, matching the ComponentFunction signature.
// A component template gets the same scope as a view: state belongs in @local.
const PREAMBLE_PROPS =
  "import { html, svg, _callComponent, computed, keyed, keyedMap, safeHtml, stop, prevent } from '@typemvc/core';\n" +
  '\n' +
  'export default function render(props) {\n' +
  '  return html`';

// Head of the generated module for a component that declares a @local block. A
// block owns state, so it also gets `signal`, `effect`, `batch` and `onCleanup`,
// and the headless behaviours from the separate behaviors entry point. The two
// imports share the first line so the preamble stays three lines, which is what
// the source map's leading unmapped line count is pinned to.
const LOCAL_PREAMBLE_HEAD =
  "import { html, svg, _callComponent, signal, computed, effect, batch, onCleanup, useForm, keyed, keyedMap, safeHtml, stop, prevent } from '@typemvc/core';" +
  "import { persisted, mediaQuery, hotkey, clickOutside } from '@typemvc/core/behaviors';\n" +
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
 * The subset of the Rollup plugin context that resolveId needs: delegating to
 * the default resolver (with `skipSelf`) turns a `.tmvc` specifier into a real
 * absolute path before it is wrapped in the virtual TypeScript id.
 */
export interface TmvcResolveContext {
  resolve(
    source: string,
    importer: string | undefined,
    options: { readonly skipSelf: boolean },
  ): Promise<{ readonly id: string } | null>;
}

/**
 * The subset of the Rollup plugin context that load needs: addWatchFile tells
 * Vite to watch the real `.tmvc` file, so editing it invalidates the virtual
 * module and triggers HMR even though the module content is read here directly.
 */
export interface TmvcLoadContext {
  addWatchFile(id: string): void;
}

/**
 * Minimal Vite plugin interface (structurally compatible with vite's Plugin
 * type without requiring vite as a package dependency).
 *
 * A `.tmvc` id is resolved to a TypeScript-suffixed virtual id so Vite's esbuild
 * pass strips the type annotations that templates and @local blocks are authored
 * with, and chains the source maps. `load` produces the module for that id.
 */
export interface TmvcPlugin {
  readonly name: 'typemvc';
  readonly enforce: 'pre';
  resolveId(
    this: TmvcResolveContext,
    source: string,
    importer: string | undefined,
  ): Promise<string | null>;
  load(this: TmvcLoadContext, id: string): TmvcTransformResult | null;
  hotUpdate(options: TmvcHotUpdateOptions): unknown[] | undefined;
  handleHotUpdate(ctx: TmvcHotContext): unknown[] | undefined;
}


export interface TmvcHotContext {
  readonly file: string;
  readonly modules: unknown[];
  readonly server?: {
    readonly moduleGraph: {
      getModuleById(id: string): unknown;
    };
  };
}

/** The kind of file system change a hot update reports. */
export type TmvcHotUpdateType = 'create' | 'update' | 'delete';

/**
 * The subset of the hot update options this plugin reads. A `.tmvc` file is
 * never a module id itself, so the module to invalidate is looked up in the
 * environment's graph by the virtual id `load` produced for it.
 */
export interface TmvcHotUpdateOptions {
  readonly type: TmvcHotUpdateType;
  readonly file: string;
  readonly modules: readonly unknown[];
  readonly environment: {
    readonly moduleGraph: {
      getModuleById(id: string): unknown;
    };
  };
}

const TMVC_VIRTUAL_SUFFIX = '.tmvc.ts';

// A .tmvc file's stylesheet is the same filename with .css appended, so it sorts
// next to the document it styles and cannot be mistaken for a hand-authored
// stylesheet that an application imports globally for its own reasons.
const TMVC_STYLE_SUFFIX = '.tmvc.css';
const CSS_EXT = '.css';

/** True when `id` is a TypeMVC virtual module id produced by resolveId. */
export function isTmvcVirtualId(id: string): boolean {
  return id.endsWith(TMVC_VIRTUAL_SUFFIX);
}

/** Wraps a real `.tmvc` path in the virtual TypeScript id. */
export function toTmvcVirtualId(realId: string): string {
  return realId + '.ts';
}

/** Recovers the real `.tmvc` path from a virtual id, or null when it is not one. */
export function fromTmvcVirtualId(id: string): string | null {
  if (!isTmvcVirtualId(id)) return null;
  return id.slice(0, -'.ts'.length);
}

/** The path of the sibling stylesheet a `.tmvc` file may have. */
export function toTmvcStylePath(realId: string): string {
  return realId + CSS_EXT;
}

/** Recovers the `.tmvc` path a sibling stylesheet styles, or null for any other file. */
export function fromTmvcStylePath(file: string): string | null {
  if (!file.endsWith(TMVC_STYLE_SUFFIX)) return null;
  return file.slice(0, -CSS_EXT.length);
}

/**
 * The specifier the generated module imports its sibling stylesheet by. The
 * generated module's id is the `.tmvc` path with a `.ts` suffix, so it sits in
 * the document's own directory and a relative specifier naming the file resolves
 * against it.
 */
function styleSpecifier(realId: string): string {
  const slash = Math.max(realId.lastIndexOf('/'), realId.lastIndexOf('\\'));
  return './' + realId.slice(slash + 1) + CSS_EXT;
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
  preambleExtraLines: number,
): string {
  const sourceLineCount = source.split('\n').length;
  const lineMap: (LineSegment | null)[] = [];

  // Preamble lines (import, blank, function open) have no source mapping. Each
  // @use directive adds one import line to the preamble, so those are unmapped
  // too and shift the mapped content down by the same amount.
  for (let i = 0; i < PREAMBLE_LINE_COUNT + preambleExtraLines; i++) {
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

/**
 * A parsed `@use { names } from 'specifier'` directive. `clause` is the import
 * clause verbatim (the text between `@use` and `from`), so named, default, and
 * namespace forms are all carried through unchanged and emitted as a plain
 * `import` in the generated module. `line` is the zero-based source line.
 */
export interface TmvcUseDirective {
  readonly clause: string;
  readonly specifier: string;
  readonly line: number;
  readonly source: string;
}

/**
 * A parsed `@parent <LayoutName>` directive, valid in a layout file only. `name`
 * is the layout's registered name, which is its filename without the extension,
 * the same name `@layout('AppLayout')` takes. `line` is the zero-based source
 * line.
 */
export interface TmvcParentDirective {
  readonly name: string;
  readonly line: number;
  readonly source: string;
}

// Matches the directive head (keyword plus following whitespace) at the start of
// the first non-blank line.
const DIRECTIVE_HEAD_RE = /^[ \t]*@(model|props)[ \t]+/;
const MODEL_FROM_RE = /^from[ \t]+([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/;

// Matches a full `@use <clause> from '<specifier>'` line, with an optional
// trailing semicolon. The clause is captured non-greedily so the first ` from `
// delimiter terminates it.
const USE_LINE_RE =
  /^[ \t]*@use[ \t]+(.+?)[ \t]+from[ \t]+(['"])([^'"]*)\2[ \t]*;?[ \t]*$/;

// Matches a full `@parent <LayoutName>` line. The name is a bare layout name, not
// an expression and not a path, so it is constrained to the characters a layout
// filename contributes to a registered name.
const PARENT_LINE_RE = /^[ \t]*@parent[ \t]+([A-Za-z_$][\w$-]*)[ \t]*$/;

function scanDirectiveEnd(source: string, start: number): number {
  const n = source.length;
  let i = start;
  let depth = 0;
  while (i < n) {
    const ch = source[i] ?? '';
    if (ch === '\\') { i += 2; continue; }
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
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { if (depth > 0) depth--; i++; continue; }
    if (ch === '\n') { if (depth <= 0) return i; i++; continue; }
    i++;
  }
  return n;
}

/**
 * Extracts the @model/@props directive starting on the first non-blank line of a
 * .tmvc source and returns the body with that directive whited out (replaced by
 * spaces, newlines preserved). The payload may span multiple lines when it opens
 * a bracket, for example a multi-line `@props { ... }` object type. Whiting out
 * in place keeps the line count and every byte offset identical, so source maps
 * and Volar mappings require no adjustment.
 *
 * Only the first non-blank line begins a directive: a later directive line is
 * left as literal text here and flagged by validateTmvcSource instead.
 */
export function extractDirective(source: string): {
  body: string;
  directive: TmvcDirective | null;
  uses: TmvcUseDirective[];
  parent: TmvcParentDirective | null;
} {
  const regions: { start: number; end: number }[] = [];
  const uses: TmvcUseDirective[] = [];
  let directive: TmvcDirective | null = null;
  let parent: TmvcParentDirective | null = null;

  // Returns the [start, end) of the next non-blank line at or after `from`, or
  // null at end of source. Blank lines are skipped.
  const nextLine = (from: number): { start: number; end: number } | null => {
    let start = from;
    while (start <= source.length) {
      let end = source.indexOf('\n', start);
      if (end === -1) end = source.length;
      if (source.slice(start, end).trim() !== '') return { start, end };
      if (end >= source.length) return null;
      start = end + 1;
    }
    return null;
  };

  // The first meaningful line may be a @model / @props directive.
  let cursor = 0;
  const first = nextLine(cursor);
  if (first === null) return { body: source, directive: null, uses, parent };

  const head = DIRECTIVE_HEAD_RE.exec(source.slice(first.start, first.end));
  if (head !== null) {
    const keyword = head[1] ?? '';
    const payloadStart = first.start + head[0].length;
    const regionEnd = scanDirectiveEnd(source, payloadStart);
    const payload = source.slice(payloadStart, regionEnd).trim();
    if (payload !== '') {
      if (keyword === 'props') {
        directive = { kind: 'props', expr: payload };
      } else {
        const fromMatch = MODEL_FROM_RE.exec(payload);
        directive = fromMatch !== null
          ? { kind: 'model-from', controller: fromMatch[1] ?? '', action: fromMatch[2] ?? '' }
          : { kind: 'model-type', expr: payload };
      }
      regions.push({ start: first.start, end: regionEnd });
      cursor = regionEnd;
    }
  }

  // Any number of @use lines, and at most one @parent line, may follow (or lead,
  // when there is no @model or @props), in any order. A @use resolves to a plain
  // import in the generated module; a @parent resolves to a named export. A
  // second @parent ends the block here and is flagged by validateTmvcSource.
  for (;;) {
    const ln = nextLine(cursor);
    if (ln === null) break;
    const text = source.slice(ln.start, ln.end);

    const use = USE_LINE_RE.exec(text);
    if (use !== null) {
      uses.push({
        clause: (use[1] ?? '').trim(),
        specifier: use[3] ?? '',
        line: countNewlines(source, ln.start),
        source: text,
      });
      regions.push({ start: ln.start, end: ln.end });
      cursor = ln.end;
      continue;
    }

    if (parent === null) {
      const parentMatch = PARENT_LINE_RE.exec(text);
      if (parentMatch !== null) {
        parent = {
          name: parentMatch[1] ?? '',
          line: countNewlines(source, ln.start),
          source: text,
        };
        regions.push({ start: ln.start, end: ln.end });
        cursor = ln.end;
        continue;
      }
    }

    break;
  }

  if (regions.length === 0) return { body: source, directive, uses, parent };

  // White out every directive region, preserving newlines so the line count and
  // every later offset stay identical.
  let body = source;
  for (const region of regions) {
    body = blankRegion(body, region.start, region.end);
  }
  return { body, directive, uses, parent };
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
  /**
   * Offset in the body where the lifted region begins (the start of the
   * `@local` line). `statements` has the same length, so source offset
   * `sourceStart + d` aligns with lifted offset `d`.
   */
  readonly sourceStart: number;
}

// Matches `@local` at the start of a line, allowing leading whitespace.
const LOCAL_OPEN_RE = /(?:^|\n)[ \t]*@local\b/;

/** True when the file id resolves under a components directory. */
export function isComponentPath(id: string): boolean {
  return id.replace(/\\/g, '/').includes('/components/');
}

/** True when the file id resolves under a layouts directory. */
export function isLayoutPath(id: string): boolean {
  return id.replace(/\\/g, '/').includes('/layouts/');
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

  return { statements, markup, startLine, lineCount, sourceStart: regionStart };
}

// ---------------------------------------------------------------------------
// Lexical masking
//
// Both scanners below replace a region with spaces of the same length rather
// than deleting it, so the line count and every byte offset stay identical and
// source maps, Volar mappings and reported line numbers need no adjustment.
// ---------------------------------------------------------------------------

// Blanks a character, keeping a newline as a newline so line accounting holds.
function blankChar(ch: string): string {
  return ch === '\n' ? '\n' : ' ';
}

/**
 * Replaces every HTML comment in a .tmvc body with spaces, preserving newlines.
 * Comments carry no runtime value, and leaving them in place feeds prose to the
 * renderer's hole scanner and to the line based validator, both of which read it
 * as markup.
 *
 * Only markup and nested template literal contexts are scanned: a `<!--` inside
 * a string or an expression is ordinary TypeScript and is left alone.
 */
export function blankHtmlComments(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n');
  const stack: StackEntry[] = [{ ctx: 'markup' }];
  const n = normalized.length;
  let result = '';
  let i = 0;

  while (i < n) {
    const ch = normalized[i] ?? '';
    const next = normalized[i + 1] ?? '';
    const top = stack.at(-1);
    if (top === undefined) break;

    // In string-like contexts, propagate escape sequences verbatim.
    if (
      (top.ctx === 'single-str' || top.ctx === 'double-str' || top.ctx === 'template') &&
      ch === '\\'
    ) {
      result += ch + next;
      i += 2;
      continue;
    }

    if ((top.ctx === 'markup' || top.ctx === 'template') && normalized.startsWith('<!--', i)) {
      // An unterminated comment runs to the end of the body, as it does in the
      // HTML parser.
      const close = normalized.indexOf('-->', i + 4);
      const end = close === -1 ? n : close + 3;
      for (let k = i; k < end; k++) {
        result += blankChar(normalized[k] ?? '');
      }
      i = end;
      continue;
    }

    switch (top.ctx) {
      case 'markup':
        if (ch === '$' && next === '{') {
          stack.push({ ctx: 'expr', depth: 1 });
          result += '${';
          i += 2;
          continue;
        }
        break;

      case 'expr':
        if (ch === '"') stack.push({ ctx: 'double-str' });
        else if (ch === "'") stack.push({ ctx: 'single-str' });
        else if (ch === '`') stack.push({ ctx: 'template' });
        else if (ch === '{') top.depth++;
        else if (ch === '}') {
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
          result += '${';
          i += 2;
          continue;
        }
        break;
    }

    result += ch;
    i++;
  }

  return result;
}

// Lexical contexts of the TypeScript masker. `code` is executable text; every
// other context is text the denylist must not read.
type MaskCtx = 'code' | 'line-comment' | 'block-comment' | 'single-str' | 'double-str' | 'template';

interface MaskFrame {
  readonly ctx: MaskCtx;
  /** Brace nesting depth, used to find the `}` that closes a `${` interpolation. */
  depth: number;
}

function stringCtxFor(quote: string): MaskCtx {
  if (quote === "'") return 'single-str';
  if (quote === '"') return 'double-str';
  return 'template';
}

function quoteFor(ctx: MaskCtx): string {
  if (ctx === 'single-str') return "'";
  if (ctx === 'double-str') return '"';
  return '`';
}

/**
 * Replaces every comment and every string literal in a TypeScript region with
 * spaces of the same length. A `${...}` interpolation inside a template literal
 * is executable code and is preserved, so a `fetch()` call there is still seen.
 *
 * The result is the same length as the input and has its newlines in the same
 * places, so a match at line L of the mask is at line L of the source.
 */
function maskCode(code: string): string {
  const frames: MaskFrame[] = [{ ctx: 'code', depth: 0 }];
  const n = code.length;
  let result = '';
  let i = 0;

  while (i < n) {
    const frame = frames.at(-1);
    if (frame === undefined) break;
    const ch = code[i] ?? '';
    const next = code[i + 1] ?? '';

    switch (frame.ctx) {
      case 'code':
        if (ch === '/' && next === '/') {
          frames.push({ ctx: 'line-comment', depth: 0 });
          result += '  ';
          i += 2;
        } else if (ch === '/' && next === '*') {
          frames.push({ ctx: 'block-comment', depth: 0 });
          result += '  ';
          i += 2;
        } else if (ch === "'" || ch === '"' || ch === '`') {
          frames.push({ ctx: stringCtxFor(ch), depth: 0 });
          result += ' ';
          i++;
        } else if (ch === '{') {
          frame.depth++;
          result += ch;
          i++;
        } else if (ch === '}' && frame.depth === 0 && frames.length > 1) {
          // Closes the `${` that opened this frame inside a template literal.
          frames.pop();
          result += ' ';
          i++;
        } else if (ch === '}') {
          frame.depth--;
          result += ch;
          i++;
        } else {
          result += ch;
          i++;
        }
        break;

      case 'line-comment':
        if (ch === '\n') frames.pop();
        result += blankChar(ch);
        i++;
        break;

      case 'block-comment':
        if (ch === '*' && next === '/') {
          frames.pop();
          result += '  ';
          i += 2;
        } else {
          result += blankChar(ch);
          i++;
        }
        break;

      case 'single-str':
      case 'double-str':
      case 'template': {
        const quote = quoteFor(frame.ctx);
        if (ch === '\\') {
          result += blankChar(ch);
          if (i + 1 < n) result += blankChar(next);
          i += 2;
        } else if (ch === quote) {
          frames.pop();
          result += ' ';
          i++;
        } else if (frame.ctx === 'template' && ch === '$' && next === '{') {
          frames.push({ ctx: 'code', depth: 0 });
          result += '  ';
          i += 2;
        } else {
          result += blankChar(ch);
          i++;
        }
        break;
      }
    }
  }

  return result;
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

  // The markup rules run against a copy with the HTML comments blanked, so prose
  // that happens to begin with a keyword is not read as a declaration. Errors are
  // still reported from `normalized`, which is the author's own text.
  const masked = blankHtmlComments(normalized);

  // The directives that occupy the top-of-file directive block. A @use or a
  // @parent on any other line is misplaced and flagged below, as is a second
  // @parent, which the block stops at.
  const block = extractDirective(normalized);
  const validUseLines = new Set(block.uses.map((u) => u.line));
  const parentLine = block.parent?.line ?? -1;

  // @parent declares which layout wraps this one, so it means nothing in a file
  // that is not a layout. The file kind is unknown to the zero-build parser,
  // which passes no id, so the rule is a build-time one.
  if (block.parent !== null && id !== undefined && !isLayoutPath(id)) {
    errors.push({
      kind: 'parent-outside-layout',
      line: block.parent.line + 1,
      source: block.parent.source,
    });
  }

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
  const n = masked.length;

  for (let i = 0; i < n; i++) {
    const ch = masked[i] ?? '';
    const next = masked[i + 1] ?? '';
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

  // Check each line that starts in markup text for forbidden constructs. The
  // check reads the masked line; the error carries the author's original line.
  const lines = normalized.split('\n');
  const maskedLines = masked.split('\n');
  // The @model directive is only valid as the first non-blank line. Track that
  // index so any later @model line, or a duplicate, can be flagged.
  const firstNonBlankIdx = lines.findIndex((l) => l.trim() !== '');
  for (let i = 0; i < lines.length; i++) {
    // Block lines are TypeScript, not markup; they are checked separately below.
    if (i >= blockFirstLine && i <= blockLastLine) continue;
    if (!(lineStartsInMarkup[i] ?? true)) continue;
    const line = maskedLines[i] ?? '';
    const original = lines[i] ?? '';
    const lineNum = i + 1;

    if (/^\s*import\s/.test(line)) {
      errors.push({ kind: 'import-statement', line: lineNum, source: original });
    } else if (/^\s*export\s/.test(line)) {
      errors.push({ kind: 'export-statement', line: lineNum, source: original });
    } else if (/^\s*(abstract\s+)?class\s/.test(line)) {
      errors.push({ kind: 'class-definition', line: lineNum, source: original });
    } else if (/^\s*@(model|props)\b/.test(line) && i !== firstNonBlankIdx) {
      errors.push({ kind: 'invalid-model-directive', line: lineNum, source: original });
    } else if (/^\s*@use\b/.test(line) && !validUseLines.has(i)) {
      errors.push({ kind: 'invalid-use-directive', line: lineNum, source: original });
    } else if (/^\s*@parent\b/.test(line) && i !== parentLine) {
      errors.push({ kind: 'invalid-parent-directive', line: lineNum, source: original });
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
    // The denylist reads a copy of the block with its comments and string
    // literals blanked: documenting why a block does no IO, in the one place the
    // framework forbids IO, is a natural thing to write and must not fail the
    // build. `statements` is line aligned with lines[blockFirstLine + k], so the
    // error still carries the author's original line.
    const maskedStatements = maskCode(localBlock.statements).split('\n');
    for (let k = 0; k < localBlock.lineCount; k++) {
      const line = maskedStatements[k] ?? '';
      const original = lines[blockFirstLine + k] ?? '';
      const lineNum = blockFirstLine + k + 1;
      if (/\bimport\b/.test(line)) {
        errors.push({ kind: 'local-import', line: lineNum, source: original });
      }
      if (/\bexport\b/.test(line)) {
        errors.push({ kind: 'local-export', line: lineNum, source: original });
      }
      if (/\b(?:async|await)\b/.test(line)) {
        errors.push({ kind: 'local-async', line: lineNum, source: original });
      }
      if (/\bfetch\b/.test(line)) {
        errors.push({ kind: 'local-fetch', line: lineNum, source: original });
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
// HTML entity decoding
//
// A plain element attribute is decoded by the browser's parser, so title="A &amp; B"
// reaches the DOM as "A & B". A component attribute never reaches a parser: its
// text becomes a JavaScript string prop, and the renderer, correctly escaping
// what it is given, prints the five characters of the reference. Decoding here
// makes the same markup mean the same thing on an element and on a component.
// ---------------------------------------------------------------------------

// The named references a template author realistically writes. The full HTML5
// table is two thousand entries and is not worth vendoring: an unrecognised
// reference is left exactly as written, which is what a browser does with one.
const NAMED_ENTITIES = Object.create(null) as Record<string, string>;
NAMED_ENTITIES.amp = '&';
NAMED_ENTITIES.lt = '<';
NAMED_ENTITIES.gt = '>';
NAMED_ENTITIES.quot = '"';
NAMED_ENTITIES.apos = "'";
NAMED_ENTITIES.nbsp = '\u00a0';
NAMED_ENTITIES.copy = '\u00a9';
NAMED_ENTITIES.reg = '\u00ae';
NAMED_ENTITIES.trade = '\u2122';
NAMED_ENTITIES.hellip = '\u2026';
NAMED_ENTITIES.mdash = '\u2014';
NAMED_ENTITIES.ndash = '\u2013';
NAMED_ENTITIES.lsquo = '\u2018';
NAMED_ENTITIES.rsquo = '\u2019';
NAMED_ENTITIES.ldquo = '\u201c';
NAMED_ENTITIES.rdquo = '\u201d';
NAMED_ENTITIES.laquo = '\u00ab';
NAMED_ENTITIES.raquo = '\u00bb';
NAMED_ENTITIES.middot = '\u00b7';
NAMED_ENTITIES.bull = '\u2022';
NAMED_ENTITIES.deg = '\u00b0';
NAMED_ENTITIES.times = '\u00d7';
NAMED_ENTITIES.euro = '\u20ac';
NAMED_ENTITIES.pound = '\u00a3';
NAMED_ENTITIES.cent = '\u00a2';
NAMED_ENTITIES.yen = '\u00a5';
NAMED_ENTITIES.sect = '\u00a7';
NAMED_ENTITIES.para = '\u00b6';

const ENTITY_RE = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/gu;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;

// Decodes the numeric part of a character reference, or null when it does not
// name a scalar value a document can hold.
function decodeNumericRef(ref: string): string | null {
  const isHex = ref[1] === 'x' || ref[1] === 'X';
  const digits = isHex ? ref.slice(2) : ref.slice(1);
  const code = Number(isHex ? '0x' + digits : digits);
  if (Number.isNaN(code) || code <= 0 || code > MAX_CODE_POINT) return null;
  if (code >= SURROGATE_START && code <= SURROGATE_END) return null;
  return String.fromCodePoint(code);
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_RE, (match: string, ref: string): string => {
    if (ref.startsWith('#')) return decodeNumericRef(ref) ?? match;
    return NAMED_ENTITIES[ref] ?? match;
  });
}

// A decoded literal must not become an expression the author never wrote:
// `&#36;{x}` decodes to `${x}`, which would otherwise be a live hole in the
// generated template literal.
function escapeTemplateHoles(text: string): string {
  return text.replace(/\$\{/gu, '\\${');
}

// ---------------------------------------------------------------------------
// Component tag rewriter
// ---------------------------------------------------------------------------

// Internal attribute representation produced by parseComponentTag.
interface AttrProp {
  readonly name: string;
  readonly kind: 'boolean' | 'static' | 'expr' | 'template' | 'spread';
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
      case 'spread':
        return `...(${attr.value})`;
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

    // Spread props: <Comp ...${obj} />
    if (ch === '.' && (source[i + 1] ?? '') === '.' && (source[i + 2] ?? '') === '.') {
      let j = i + 3;
      while (j < n && /\s/u.test(source[j] ?? '')) j++;
      if ((source[j] ?? '') !== '$' || (source[j + 1] ?? '') !== '{') return null;
      const exprResult = scanExpression(source, j + 2);
      if (exprResult === null) return null;
      attrs.push({ name: '', kind: 'spread', value: exprResult.content });
      i = exprResult.end;
      continue;
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

    // Classify the collected segments into the appropriate AttrProp kind. A text
    // segment is markup and its entities are decoded; an expr segment is
    // TypeScript source and passes through verbatim.
    const seg0 = segments[0];
    if (segments.length === 0) {
      attrs.push({ name: attrName, kind: 'static', value: '' });
    } else if (segments.length === 1 && seg0?.kind === 'text') {
      attrs.push({ name: attrName, kind: 'static', value: decodeEntities(seg0.content) });
    } else if (segments.length === 1 && seg0?.kind === 'expr') {
      attrs.push({ name: attrName, kind: 'expr', value: seg0.content });
    } else {
      // Mixed text and expressions: produce a template literal
      const raw = segments
        .map((s) =>
          s.kind === 'text'
            ? escapeTemplateHoles(decodeEntities(s.content))
            : '${' + s.content + '}',
        )
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
// @local component tag rewriter
//
// A @local block is TypeScript, not markup, so the component tag rewrite must
// fire only inside an html`` or svg`` tagged template literal. A `<Pill/>` in a
// string literal, a comment, or bare code is not markup and is left untouched.
// The rewrite preserves the line count (any newlines a collapsed multi-line tag
// would drop are re-appended), so the lifted block's line based source map and
// the Volar block mapping stay aligned.
// ---------------------------------------------------------------------------

// Lexical frames for the @local rewriter. `code` is executable TypeScript, at
// the top level (interp false) or inside a `${` interpolation (interp true).
type LocalFrame =
  | { kind: 'code'; depth: number; interp: boolean }
  | { readonly kind: 'single-str' }
  | { readonly kind: 'double-str' }
  | { readonly kind: 'line-comment' }
  | { readonly kind: 'block-comment' }
  | { readonly kind: 'template'; readonly markup: boolean };

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/u.test(ch);
}

function countNewlinesIn(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === '\n') count++;
  }
  return count;
}

/**
 * Rewrites PascalCase component tags to ${_callComponent(...)} expressions, but
 * only inside html`` and svg`` tagged template literals found within TypeScript
 * code. Applied to lifted `@local` statements so a reactive list row may use a
 * component tag. A tag outside such a template (in a string, a comment, or bare
 * code) is left exactly as written.
 */
export function rewriteLocalComponentTags(source: string): string {
  const s = source.replace(/\r\n/g, '\n');
  const n = s.length;
  const stack: LocalFrame[] = [{ kind: 'code', depth: 0, interp: false }];
  let out = '';
  let i = 0;
  // The last completed identifier in the current code frame, so a following
  // backtick can be recognised as an html`` or svg`` tagged template.
  let ident = '';
  let lastIdent = '';

  while (i < n) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const ch = s[i] ?? '';
    const next = s[i + 1] ?? '';

    if (frame.kind === 'code') {
      if (isIdentChar(ch)) {
        ident += ch;
        out += ch;
        i++;
        continue;
      }
      if (ident.length > 0) {
        lastIdent = ident;
        ident = '';
      }
      if (ch === '/' && next === '/') {
        stack.push({ kind: 'line-comment' });
        out += ch;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        stack.push({ kind: 'block-comment' });
        out += ch;
        i++;
        continue;
      }
      if (ch === "'") {
        stack.push({ kind: 'single-str' });
        out += ch;
        i++;
        lastIdent = '';
        continue;
      }
      if (ch === '"') {
        stack.push({ kind: 'double-str' });
        out += ch;
        i++;
        lastIdent = '';
        continue;
      }
      if (ch === '`') {
        stack.push({ kind: 'template', markup: lastIdent === 'html' || lastIdent === 'svg' });
        out += ch;
        i++;
        lastIdent = '';
        continue;
      }
      if (ch === '{') {
        frame.depth++;
        out += ch;
        i++;
        lastIdent = '';
        continue;
      }
      if (ch === '}') {
        if (frame.depth > 0) {
          frame.depth--;
          lastIdent = '';
        } else if (frame.interp) {
          stack.pop();
        } else {
          lastIdent = '';
        }
        out += ch;
        i++;
        continue;
      }
      // Whitespace keeps the tag candidate alive; any other character clears it.
      if (!/\s/u.test(ch)) lastIdent = '';
      out += ch;
      i++;
      continue;
    }

    if (frame.kind === 'line-comment') {
      if (ch === '\n') stack.pop();
      out += ch;
      i++;
      continue;
    }

    if (frame.kind === 'block-comment') {
      if (ch === '*' && next === '/') {
        stack.pop();
        out += ch + next;
        i += 2;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (frame.kind === 'single-str' || frame.kind === 'double-str') {
      const quote = frame.kind === 'single-str' ? "'" : '"';
      if (ch === '\\') {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === quote) stack.pop();
      out += ch;
      i++;
      continue;
    }

    // template literal
    if (ch === '\\') {
      out += ch + next;
      i += 2;
      continue;
    }
    if (ch === '`') {
      stack.pop();
      out += ch;
      i++;
      continue;
    }
    if (ch === '$' && next === '{') {
      stack.push({ kind: 'code', depth: 0, interp: true });
      out += '${';
      i += 2;
      continue;
    }
    if (frame.markup && ch === '<' && /[A-Z]/u.test(next)) {
      const parsed = parseComponentTag(s, i);
      if (parsed !== null) {
        const consumed = s.slice(i, parsed.end);
        out += parsed.output;
        const lost = countNewlinesIn(consumed) - countNewlinesIn(parsed.output);
        for (let k = 0; k < lost; k++) out += '\n';
        i = parsed.end;
        continue;
      }
    }
    out += ch;
    i++;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Code generator
// ---------------------------------------------------------------------------

// Builds the plain `import` lines a set of @use directives compiles to, one per
// line, terminated by a newline so each occupies exactly one generated line. The
// Volar virtual file emits the same imports so the editor and the build agree.
export function buildUseImports(uses: readonly TmvcUseDirective[]): string {
  let out = '';
  for (const u of uses) {
    out += `import ${u.clause} from '${u.specifier}';\n`;
  }
  return out;
}

// Inserts the @use import lines directly after the core import line of a
// preamble, keeping them at module scope where the template body and any lifted
// @local statements can reference them.
function injectUseImports(preamble: string, useImports: string): string {
  if (useImports === '') return preamble;
  const firstNl = preamble.indexOf('\n');
  if (firstNl === -1) return useImports + preamble;
  return preamble.slice(0, firstNl + 1) + useImports + preamble.slice(firstNl + 1);
}

// Appends a statement to the end of the preamble's core import line, rather than
// putting it on a line of its own. The generated module's preamble line count is
// what the source map's leading unmapped lines are pinned to, so anything the
// preamble carries beyond that import must not add a line to it.
function appendToFirstLine(preamble: string, statement: string): string {
  const firstNl = preamble.indexOf('\n');
  if (firstNl === -1) return preamble + statement;
  return preamble.slice(0, firstNl) + statement + preamble.slice(firstNl);
}

// A layout that names a parent exports it for bootstrap to read off the glob entry.
function injectParentExport(preamble: string, parent: TmvcParentDirective | null): string {
  if (parent === null) return preamble;
  return appendToFirstLine(preamble, ` export const parent = ${JSON.stringify(parent.name)};`);
}

// A document with a sibling stylesheet imports it, so the bundler owns the rest:
// a style tag in dev, an extracted asset in a build, and the stylesheet split into
// the same chunk as the document that uses it.
function injectStyleImport(preamble: string, id: string, hasStyles: boolean): string {
  if (!hasStyles) return preamble;
  return appendToFirstLine(preamble, ` import ${JSON.stringify(styleSpecifier(id))};`);
}

/**
 * Transforms .tmvc source into a Phase 1-compatible TypeScript module with an
 * accurate V3 source map. `hasStyles` says whether the sibling stylesheet exists,
 * which only the caller that can reach the filesystem knows.
 */
export function transformTmvc(
  source: string,
  id: string,
  hasStyles = false,
): TmvcTransformResult {
  // The @model/@props directive is a Volar-only type hint; strip it (whited out
  // in place so the source map stays byte-accurate) before generating runtime JS.
  // @use directives are stripped the same way and re-emitted as plain imports,
  // and a layout's @parent as a named export bootstrap reads off the glob entry.
  const { body, uses, parent } = extractDirective(source);
  const useImports = buildUseImports(uses);
  const isComponent = isComponentPath(id);

  // A @local block lifts to component-scope statements; views never have one.
  const localBlock = isComponent ? extractLocalBlock(body) : null;
  const markupBody = localBlock !== null ? localBlock.markup : body;

  // HTML comments carry no runtime value. Blanking them here, rather than only
  // teaching the scanner to skip them, keeps a comment from reaching the renderer
  // at all: no hole inside one is evaluated and no component tag inside one is
  // rewritten. Blanking preserves every line and column, so the map is unchanged.
  const commentFree = blankHtmlComments(markupBody);
  const rewritten = rewriteComponentTags(commentFree);
  const escaped = escapeTmvcMarkup(rewritten);

  // The style import and the parent export ride on the core import line, and the
  // @use imports take a line each, which generateSourceMap is told about below.
  const head = (preamble: string): string =>
    injectUseImports(
      injectParentExport(injectStyleImport(preamble, id, hasStyles), parent),
      useImports,
    );

  let code: string;
  if (localBlock !== null) {
    // Component tags inside html`` or svg`` literals in the block must render as
    // components, so the reactive list row case works. The rewrite preserves the
    // block's line count, so the source map below needs no adjustment.
    const statements = rewriteLocalComponentTags(localBlock.statements);
    code = head(LOCAL_PREAMBLE_HEAD) + statements + '\n  return html`' + escaped + SUFFIX;
  } else {
    code = head(isComponent ? PREAMBLE_PROPS : PREAMBLE_CONTEXT) + escaped + SUFFIX;
  }

  const block = localBlock !== null
    ? { startLine: localBlock.startLine, lineCount: localBlock.lineCount }
    : null;
  const map = generateSourceMap(source, id, block, uses.length);
  return { code, map };
}

// ---------------------------------------------------------------------------
// Error description helpers
// ---------------------------------------------------------------------------

export function describeValidationError(err: TmvcValidationError): string {
  switch (err.kind) {
    case 'import-statement':
      return 'import declarations are not permitted. To bring a module value into a template, declare it at the top of the file with @use { name } from \'module\'. To load data, use a controller and pass it through the view context.';
    case 'export-statement':
      return 'export declarations are not permitted. The default export is generated by the framework, so delete this line.';
    case 'class-definition':
      return 'class definitions are not permitted. Views are pure templates: move the class into a controller, a service, or a model module.';
    case 'invalid-model-directive':
      return 'the @model directive must be the first non-blank line of the view, and may appear only once.';
    case 'invalid-use-directive':
      return 'a @use directive must sit in the directive block at the top of the file, after any @model or @props line and before the markup.';
    case 'invalid-parent-directive':
      return 'a @parent directive must sit in the directive block at the top of the file, before the markup, may appear only once, and takes one layout name: @parent AppLayout.';
    case 'parent-outside-layout':
      return 'the @parent directive is only allowed in a layout file, because it names the layout that wraps this one. A view chooses its layout with @layout on the controller or the action.';
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
// TypeScript annotation detection
//
// The build pipeline hands the generated module to esbuild, which strips type
// annotations. The zero-build runtime parser has no such step, so a typed
// declaration would either be a SyntaxError or, worse, valid-but-wrong
// JavaScript (`signal<number>(0)` parses as two comparisons and yields a
// boolean). These patterns catch the type syntax a @local block realistically
// carries so the parser can reject it with a clear message instead.
// ---------------------------------------------------------------------------

const TYPE_ANNOTATION_PATTERNS: readonly RegExp[] = [
  // interface / enum / declare / namespace declarations.
  /\b(?:interface|enum|declare|namespace)\s+[A-Za-z_$]/,
  // A `type X =` alias (not a property whose key happens to be `type`).
  /(?:^|[;{}\n])\s*type\s+[A-Za-z_$][\w$]*\s*(?:<[^=]*>)?\s*=/,
  // A generic call or construction, e.g. `signal<number>(0)`.
  /[A-Za-z_$][\w$]*\s*<[A-Za-z_$][\w$.,[\]| \t]*>\s*\(/,
  // A variable annotation, e.g. `const x: string[]`.
  /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:/,
  // A function-declaration return type, e.g. `function inc(): void`.
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*:/,
  // A parameter annotation against a primitive or a PascalCase type name.
  /[(,]\s*[A-Za-z_$][\w$]*\s*:\s*(?:void|string|number|boolean|unknown|any|never|null|undefined|object|bigint|symbol|readonly\b|[A-Z][\w$]*)/,
  // A type assertion (`x as Foo`, `x as const`) or `satisfies`.
  /\bas\s+(?:const\b|[A-Za-z_$][\w$]*)/,
  /\bsatisfies\s+[A-Za-z_$]/,
];

/**
 * Returns true when TypeScript-only type syntax is present in a block of code.
 * The input is masked first so annotations inside strings and comments do not
 * count. Intended for `@local` statements, which the runtime parser cannot type
 * strip.
 */
export function hasTypeAnnotation(code: string): boolean {
  const masked = maskCode(code);
  return TYPE_ANNOTATION_PATTERNS.some((re) => re.test(masked));
}

// ---------------------------------------------------------------------------
// Module loader
// ---------------------------------------------------------------------------

/**
 * Validates a .tmvc source and produces its generated TypeScript module. Throws
 * a `[TypeMVC]` error naming the first validation failure. `realId` is the real
 * `.tmvc` path (not the virtual id), so component-versus-view detection and the
 * source map both point at the file the author edits. `hasStyles` says whether
 * the sibling stylesheet exists.
 */
export function loadTmvcModule(
  source: string,
  realId: string,
  hasStyles = false,
): TmvcTransformResult {
  const errors = validateTmvcSource(source, realId);
  const first = errors[0];
  if (first !== undefined) {
    throw new Error(
      `[TypeMVC] .tmvc transform error at line ${String(first.line)}: ` +
        describeValidationError(first),
    );
  }
  return transformTmvc(source, realId, hasStyles);
}

// Drops a query suffix (for example `?import`) that Vite may append to a
// resolved id, leaving a path readFileSync can open.
function stripQuery(id: string): string {
  const q = id.indexOf('?');
  return q === -1 ? id : id.slice(0, q);
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Creates the TypeMVC Vite plugin. A `.tmvc` import is resolved to a
 * TypeScript-suffixed virtual id whose module is produced by `load`, so Vite's
 * esbuild pass strips the type annotations the template and any @local block are
 * authored with and chains the source maps back to the original `.tmvc` file.
 */
export function typemvcPlugin(): TmvcPlugin {
  return {
    name: 'typemvc',
    enforce: 'pre',

    async resolveId(
      this: TmvcResolveContext,
      source: string,
      importer: string | undefined,
    ): Promise<string | null> {
      const stripped = stripQuery(source);

      // Two shapes arrive here. A plain `.tmvc` specifier, from an import or a
      // glob. And a virtual id this plugin already produced, which Vite hands
      // back after a round trip through the module's URL.
      //
      // That round trip is why the virtual id cannot simply be returned as it
      // came. The URL of a module inside the project root is root-relative, so
      // the id comes back as `/src/components/Card.tmvc.ts`, and `load` would
      // then read `/src/components/Card.tmvc` against the filesystem root: on
      // Windows that is `C:\src\components\Card.tmvc`, which does not exist.
      // Both shapes are therefore reduced to the real `.tmvc` path and resolved
      // to an absolute one.
      const real = isTmvcVirtualId(stripped)
        ? fromTmvcVirtualId(stripped)
        : stripped.endsWith('.tmvc')
          ? stripped
          : null;
      if (real === null) return null;

      // Let the default resolver turn the specifier into a real absolute path,
      // skipping this plugin so the call does not recurse. Resolving an already
      // absolute path is a no-op, so this is idempotent.
      const resolved = await this.resolve(real, importer, { skipSelf: true });
      if (resolved === null) return null;
      return toTmvcVirtualId(stripQuery(resolved.id));
    },

    load(this: TmvcLoadContext, id: string): TmvcTransformResult | null {
      const realId = fromTmvcVirtualId(id);
      if (realId === null) return null;

      // Watch the real file so an edit invalidates this virtual module: the
      // content is read here directly, so Vite would not otherwise track it.
      this.addWatchFile(realId);
      const source = readFileSync(realId, 'utf8');

      // The sibling stylesheet is not watched here. It is imported by the module
      // this returns, so the bundler already tracks it, and watching it as well
      // would re-transform the document for a change that granular CSS
      // replacement handles on its own. A stylesheet that appears or disappears
      // is picked up by the hot update hook instead.
      return loadTmvcModule(source, realId, existsSync(toTmvcStylePath(realId)));
    },

    hotUpdate(options: TmvcHotUpdateOptions): unknown[] | undefined {
      const { file, type, modules, environment } = options;
      const virtualOf = (tmvc: string): unknown =>
        environment.moduleGraph.getModuleById(toTmvcVirtualId(tmvc));

      // A stylesheet that appeared or was deleted changes the generated module,
      // which imports it only when it is on disk. Nothing else invalidates that
      // module, because it did not import the file before it existed, and no
      // longer imports it once it is gone. Editing one needs no invalidation:
      // the import is in the graph, so the bundler replaces the styles alone.
      const styled = fromTmvcStylePath(file);
      if (styled !== null) {
        if (type === 'update') return undefined;
        const virtual = virtualOf(styled);
        if (virtual === undefined || virtual === null) return undefined;
        return [...modules, virtual];
      }

      if (type !== 'update' || !file.endsWith('.tmvc')) return undefined;

      // modules is empty for a .tmvc file, whose module id is the virtual one, so
      // the generated module has to be fetched by that id and handed back, or the
      // edit never reaches the browser.
      const virtual = virtualOf(file);
      if (virtual === undefined || virtual === null) return [...modules];
      return modules.includes(virtual) ? [...modules] : [...modules, virtual];
    },

    // The hook above supersedes this one, which is kept for a bundler that does
    // not call it. It is never reached for a create or a delete, which is why the
    // stylesheet cases cannot live here.
    handleHotUpdate(ctx: TmvcHotContext): unknown[] | undefined {
      if (!ctx.file.endsWith('.tmvc')) return undefined;

      const virtual = ctx.server?.moduleGraph.getModuleById(toTmvcVirtualId(ctx.file));
      if (virtual === undefined || virtual === null) return ctx.modules;
      return ctx.modules.includes(virtual) ? ctx.modules : [...ctx.modules, virtual];
    },
  };
}
