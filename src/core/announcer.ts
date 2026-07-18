/**
 * The route announcer: a polite live region that names each completed navigation
 * so a screen reader announces the new page.
 *
 * A browser announces a fresh document load by itself. A client side navigation
 * replaces the outlet with no such signal: the Navigation API resets focus, but
 * focus reset moves focus, it does not say what the user has arrived at. Only the
 * router knows a route changed, so the framework owns the region rather than the
 * application, which could not reliably keep one alive across an outlet
 * replacement.
 */
export interface RouteAnnouncer {
  /** The live region element. It lives outside the outlet, so a mount cannot remove it. */
  readonly element: Element;
  /** Names the route. Call after the view has mounted, never before. */
  readonly announce: (text: string) => void;
}

/**
 * `display: none` and the `hidden` attribute both take an element out of the
 * accessibility tree, which would silence the announcement. The clip rectangle is
 * the pattern that hides the region on screen and keeps it announceable.
 *
 * The declarations are inline so the announcement holds in an application with no
 * stylesheet of its own, and cannot be undone by one that has.
 */
const HIDDEN_STYLE = [
  'position:absolute',
  'width:1px',
  'height:1px',
  'margin:-1px',
  'padding:0',
  'border:0',
  'overflow:hidden',
  'clip:rect(0 0 0 0)',
  'clip-path:inset(50%)',
  'white-space:nowrap',
].join(';');

/**
 * Creates the live region and appends it to the document body, outside the outlet.
 *
 * @param doc - The document that owns the outlet.
 */
export function createRouteAnnouncer(doc: Document): RouteAnnouncer {
  const element = doc.createElement('div');
  element.className = 'tmvc-route-announcer';
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  element.setAttribute('style', HIDDEN_STYLE);
  doc.body.appendChild(element);

  return {
    element,
    announce: (text: string): void => {
      // textContent is not a markup sink, so a route name lands as the text it is
      // and is never parsed as HTML.
      element.textContent = text;
    },
  };
}
