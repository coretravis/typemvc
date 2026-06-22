export interface CompiledPattern {
  readonly regexp: RegExp;
  readonly paramNames: readonly string[];
  readonly optionalParams: ReadonlySet<string>;
}

export interface RouteMatch {
  readonly params: Readonly<Record<string, string>>;
}

export function compileRoutePattern(basePath: string, segment: string): CompiledPattern {
  const combined = combinePaths(basePath, segment);
  const parts = combined.split('/').filter((p): p is string => p.length > 0);

  const paramNames: string[] = [];
  const optionalParams = new Set<string>();
  const regexpParts: string[] = ['^'];

  for (const part of parts) {
    const optMatch = /^\{([A-Za-z_$][A-Za-z0-9_$]*)\?\}$/.exec(part);
    if (optMatch !== null) {
      const name = optMatch[1];
      if (name === undefined) continue;
      paramNames.push(name);
      optionalParams.add(name);
      regexpParts.push(`(?:\\/(?<${name}>[^\\/]+))?`);
      continue;
    }

    const reqMatch = /^\{([A-Za-z_$][A-Za-z0-9_$]*)\}$/.exec(part);
    if (reqMatch !== null) {
      const name = reqMatch[1];
      if (name === undefined) continue;
      paramNames.push(name);
      regexpParts.push(`\\/(?<${name}>[^\\/]+)`);
      continue;
    }

    regexpParts.push(`\\/${escapeRegex(part)}`);
  }

  regexpParts.push('\\/?$');

  return {
    regexp: new RegExp(regexpParts.join('')),
    paramNames,
    optionalParams,
  };
}

export function matchRoute(compiled: CompiledPattern, pathname: string): RouteMatch | null {
  const match = compiled.regexp.exec(pathname);
  if (match === null) return null;

  const rawGroups = match.groups;
  const params = Object.create(null) as Record<string, string>;

  for (const name of compiled.paramNames) {
    const value = rawGroups !== undefined ? rawGroups[name] : undefined;
    if (value !== undefined && value !== '') {
      params[name] = value;
    }
  }

  return { params };
}

function combinePaths(basePath: string, segment: string): string {
  const base = basePath.replace(/\/+$/, '');
  const seg = segment.replace(/^\/+/, '');
  if (seg === '') return base;
  return `${base}/${seg}`;
}

/**
 * Computes the specificity score for a route pattern.
 *
 * Scoring per path segment:
 *   literal segment  = 2
 *   required param   = 1
 *   optional param   = 0
 *   catch-all '*'    = -1 (always matched last)
 *
 * Higher scores are matched first.
 */
export function computeRouteSpecificity(basePath: string, segment: string): number {
  if (basePath === '*') return -1;

  const combined = combinePaths(basePath, segment);
  const parts = combined.split('/').filter((p): p is string => p.length > 0);

  let score = 0;
  for (const part of parts) {
    if (/^\{[A-Za-z_$][A-Za-z0-9_$]*\?\}$/.test(part)) {
      // optional param: 0 points
    } else if (/^\{[A-Za-z_$][A-Za-z0-9_$]*\}$/.test(part)) {
      score += 1;
    } else {
      score += 2;
    }
  }

  return score;
}

/**
 * Returns a CompiledPattern that matches any pathname.
 * Used for '*' catch-all routes registered with basePath '*'.
 */
export function compileCatchAll(): CompiledPattern {
  return {
    regexp: /^[\s\S]*$/,
    paramNames: [],
    optionalParams: new Set<string>(),
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
