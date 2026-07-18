/**
 * Wraps a handler to call event.preventDefault() before delegating.
 *
 * Usage: html`<form onsubmit=${prevent(handleSubmit)}>`
 */
export function prevent<E extends Event>(handler: (e: E) => void): (e: E) => void {
  return (e: E): void => {
    e.preventDefault();
    handler(e);
  };
}

/**
 * Wraps a handler to call event.stopPropagation() before delegating.
 *
 * Usage: html`<div onclick=${stop(handleClick)}>`
 */
export function stop<E extends Event>(handler: (e: E) => void): (e: E) => void {
  return (e: E): void => {
    e.stopPropagation();
    handler(e);
  };
}
