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

/**
 * Sanitizes a `srcset` value, which is a comma-separated list of candidates, each a
 * URL optionally followed by a descriptor (`image.jpg 2x`, `image.jpg 480w`). Each
 * candidate's URL is sanitized on its own, so a dangerous scheme in any position is
 * neutralised rather than only the first, which a single-URL sanitize would miss.
 */
export function sanitizeSrcset(value: string): string {
  const candidates: string[] = [];
  for (const candidate of value.split(',')) {
    const trimmed = candidate.trim();
    if (trimmed === '') continue;
    const match = /^(\S+)(\s[\s\S]*)?$/.exec(trimmed);
    if (match === null) continue;
    const urlPart = match[1] ?? '';
    const descriptor = match[2] ?? '';
    candidates.push(sanitizeUrl(urlPart) + descriptor);
  }
  return candidates.join(', ');
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
