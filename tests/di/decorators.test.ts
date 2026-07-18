import { describe, it, expect, vi, afterEach } from 'vitest';
import { inject, getInjectTokens } from '../../src/di/decorators.js';
import { resolveInjectedArgs } from '../../src/di/injector.js';
import { Container } from '../../src/di/container.js';

const NAV = Symbol('NavService');
const CLOCK = Symbol('ClockService');

class Nav {
  readonly name = 'nav';
}

class Clock {
  readonly name = 'clock';
}

function makeContainer(): Container {
  const container = new Container();
  container.singleton(NAV, () => new Nav());
  container.singleton(CLOCK, () => new Clock());
  return container;
}

// A decorated base, extended in the shapes an application actually writes.
class Shell {
  constructor(@inject(NAV) readonly nav: unknown) {}
}

class InheritsShell extends Shell {}

class InheritsThroughMiddle extends InheritsShell {}

class OwnConstructor extends Shell {
  constructor(@inject(CLOCK) readonly clock: unknown) {
    super(clock);
  }
}

class OwnConstructorNoInject extends Shell {
  constructor(readonly whatever: unknown) {
    super(whatever);
  }
}

class NoDependencies {
  readonly ready = true;
}

class UndecoratedWithParameters {
  constructor(
    readonly first: unknown,
    readonly second: unknown,
  ) {}
}

class PartiallyDecorated {
  constructor(
    readonly first: unknown,
    @inject(CLOCK) readonly second: unknown,
  ) {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getInjectTokens', () => {
  it('returns the tokens declared on the class itself', () => {
    expect(getInjectTokens(Shell)).toEqual([NAV]);
  });

  it('inherits the base tokens when the subclass declares no constructor', () => {
    expect(getInjectTokens(InheritsShell)).toEqual([NAV]);
  });

  it('inherits through a chain where no intermediate class declares a constructor', () => {
    expect(getInjectTokens(InheritsThroughMiddle)).toEqual([NAV]);
  });

  it('uses the subclass tokens when it declares its own decorated constructor', () => {
    expect(getInjectTokens(OwnConstructor)).toEqual([CLOCK]);
  });

  it('does not inherit into a subclass that declares its own undecorated constructor', () => {
    expect(getInjectTokens(OwnConstructorNoInject)).toEqual([]);
  });

  it('returns no tokens for a class with no injected dependencies', () => {
    expect(getInjectTokens(NoDependencies)).toEqual([]);
  });
});

describe('resolveInjectedArgs', () => {
  it('resolves an inherited dependency for a subclass with no constructor', () => {
    const args = resolveInjectedArgs(makeContainer(), InheritsShell, 'Controller');
    expect(args).toHaveLength(1);
    expect(args[0]).toBeInstanceOf(Nav);
    expect(new InheritsShell(args[0]).nav).toBeInstanceOf(Nav);
  });

  it('resolves the subclass own tokens rather than the base tokens', () => {
    const args = resolveInjectedArgs(makeContainer(), OwnConstructor, 'Controller');
    expect(args[0]).toBeInstanceOf(Clock);
  });

  it('constructs a class with no dependencies without arguments and without error', () => {
    const args = resolveInjectedArgs(makeContainer(), NoDependencies, 'Controller');
    expect(args).toEqual([]);
    expect(new NoDependencies().ready).toBe(true);
  });

  it('warns when a constructor takes more parameters than it has tokens for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    resolveInjectedArgs(makeContainer(), UndecoratedWithParameters, 'Controller');

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('[TypeMVC]');
    expect(message).toContain('UndecoratedWithParameters');
    expect(message).toContain('2 constructor parameters');
    expect(message).toContain('@inject');
    expect(message).toContain('remove its constructor');
  });

  it('warns for a subclass whose own constructor drops the base injection metadata', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const args = resolveInjectedArgs(makeContainer(), OwnConstructorNoInject, 'Controller');

    expect(args).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('OwnConstructorNoInject');
  });

  it('does not warn when every parameter has a token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resolveInjectedArgs(makeContainer(), InheritsShell, 'Controller');
    expect(warn).not.toHaveBeenCalled();
  });

  it('throws naming the role, the class and the index for a gap in the decorated parameters', () => {
    expect(() => resolveInjectedArgs(makeContainer(), PartiallyDecorated, 'Guard')).toThrow(
      /\[TypeMVC\] Guard "PartiallyDecorated" constructor parameter at index 0 has no @inject/,
    );
  });
});
