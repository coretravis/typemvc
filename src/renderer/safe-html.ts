/**
 * Opaque wrapper for pre-sanitized HTML strings. Values of this type bypass
 * the default HTML escaping in the template renderer. Obtain one only via
 * the safeHtml() factory -- never cast strings directly to this type.
 */
export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

/**
 * Marks a string as already-sanitized HTML so the template renderer inserts it
 * as raw markup instead of escaping it. Only pass trusted or sanitized input:
 * unsanitized user content here is an XSS risk.
 *
 * @param html - A trusted HTML string.
 * @returns A {@link SafeHtml} wrapper recognized by the renderer.
 */
export function safeHtml(html: string): SafeHtml {
  return new SafeHtml(html);
}
