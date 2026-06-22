const HTML_ESCAPE_MAP = Object.create(null) as Record<string, string>;
HTML_ESCAPE_MAP['&'] = '&amp;';
HTML_ESCAPE_MAP['<'] = '&lt;';
HTML_ESCAPE_MAP['>'] = '&gt;';
HTML_ESCAPE_MAP['"'] = '&quot;';
HTML_ESCAPE_MAP["'"] = '&#39;';

const ATTR_ESCAPE_MAP = Object.create(null) as Record<string, string>;
ATTR_ESCAPE_MAP['&'] = '&amp;';
ATTR_ESCAPE_MAP['<'] = '&lt;';
ATTR_ESCAPE_MAP['>'] = '&gt;';
ATTR_ESCAPE_MAP['"'] = '&quot;';
ATTR_ESCAPE_MAP["'"] = '&#39;';
ATTR_ESCAPE_MAP['`'] = '&#96;';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function escapeAttr(value: string): string {
  return value.replace(/[&<>"'`]/g, (ch) => ATTR_ESCAPE_MAP[ch] ?? ch);
}

const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function sanitizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  // Relative paths and fragment-only URLs are always safe.
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('?')
  ) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed, 'https://safe.invalid');
    if (ALLOWED_URL_SCHEMES.has(url.protocol)) return trimmed;
  } catch {
    // If URL parsing fails, treat as a relative path.
    return trimmed;
  }
  return '#';
}

export const BOOLEAN_ATTRS: ReadonlySet<string> = new Set([
  'disabled',
  'checked',
  'hidden',
  'readonly',
  'required',
  'selected',
  'multiple',
  'autofocus',
  'autoplay',
  'controls',
  'loop',
  'muted',
  'open',
  'default',
  'defer',
  'async',
  'novalidate',
  'ismap',
  'reversed',
  'scoped',
  'seamless',
  'itemscope',
]);

export const URL_ATTRS: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'cite',
  'data',
  'poster',
  'srcset',
]);

export function isUrlAttribute(attrName: string): boolean {
  return (
    URL_ATTRS.has(attrName) ||
    (attrName.startsWith('data-') && attrName.endsWith('-url'))
  );
}
