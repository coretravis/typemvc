export interface ParsedTemplate {
  readonly template: HTMLTemplateElement;
  readonly bindingCount: number;
}

const SENTINEL_PREFIX = '__tmvc_b';
const SENTINEL_SUFFIX = '__';
export const ATTR_SENTINEL_PREFIX = '__tmvc_ba';
export const ATTR_SENTINEL_SUFFIX = '__';

function isAttrValuePosition(str: string): boolean {
  const trimmed = str.trimEnd();
  if (trimmed.endsWith('="') || trimmed.endsWith("='")) return true;
  return /[\w-]=$/u.test(trimmed);
}

export function buildRawHtml(strings: TemplateStringsArray): string {
  let result = strings[0] ?? '';
  for (let i = 1; i < strings.length; i++) {
    const prev = strings[i - 1] ?? '';
    if (isAttrValuePosition(prev)) {
      result += ATTR_SENTINEL_PREFIX + String(i - 1) + ATTR_SENTINEL_SUFFIX;
    } else {
      result += '<!--' + SENTINEL_PREFIX + String(i - 1) + SENTINEL_SUFFIX + '-->';
    }
    result += strings[i] ?? '';
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

export function parseAttrSentinelIndex(value: string): number | null {
  if (!value.startsWith(ATTR_SENTINEL_PREFIX)) return null;
  const rest = value.slice(ATTR_SENTINEL_PREFIX.length);
  if (!rest.endsWith(ATTR_SENTINEL_SUFFIX)) return null;
  const inner = rest.slice(0, rest.length - ATTR_SENTINEL_SUFFIX.length);
  const index = Number(inner);
  return Number.isNaN(index) ? null : index;
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
