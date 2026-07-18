import type { Container } from './container.js';
import type { ConstructorMeta } from './decorators.js';
import { getInjectTokens } from './decorators.js';

/** How a class being constructed is named in diagnostics. */
export type InjectionRole = 'Controller' | 'Guard' | 'Class';

/**
 * Resolves the constructor arguments for a class from the container, in
 * declaration order. Throws when a parameter sits between decorated ones without
 * an `@inject` of its own, and warns in development when the constructor takes
 * more parameters than there are tokens for it, which is the shape that would
 * otherwise construct the class with `undefined` dependencies.
 */
export function resolveInjectedArgs(
  container: Container,
  cls: ConstructorMeta,
  role: InjectionRole,
): unknown[] {
  const tokens = getInjectTokens(cls);

  if (__DEV__ && cls.length > tokens.length) {
    console.warn(
      `[TypeMVC] ${role} "${cls.name}" declares ${String(cls.length)} constructor ` +
        `parameters but only ${String(tokens.length)} have @inject metadata, so the rest ` +
        `are constructed as undefined. Decorate them with @inject, or, if it extends a ` +
        `base class that already declares them, remove its constructor to inherit the ` +
        `base's injection metadata.`,
    );
  }

  // Indexed rather than mapped: a partially decorated constructor leaves holes in
  // the token array, and Array#map skips holes, so the guard below would not run.
  const args: unknown[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) {
      throw new Error(
        `[TypeMVC] ${role} "${cls.name}" constructor parameter at index ${String(index)} ` +
          `has no @inject decorator. All injected parameters must be decorated with @inject.`,
      );
    }
    args.push(container.resolve(token));
  }
  return args;
}
