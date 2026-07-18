/** Default views root directory. Callers may override via AppConfig.viewsRoot. */
export const DEFAULT_VIEWS_ROOT = 'views/';

/**
 * Resolves a view path from an IView result.
 *
 * @param iviewPath  - The path stored on the IView. null triggers convention resolution.
 * @param controllerName - The controller class `.name` property.
 * @param actionName - The action method name (as declared on the class).
 * @param viewsRoot  - The views root directory (from AppConfig, default 'views/').
 */
export function resolveViewPath(
  iviewPath: string | null,
  controllerName: string,
  actionName: string,
  viewsRoot: string,
): string {
  if (iviewPath !== null) {
    if (iviewPath.startsWith('/')) {
      return iviewPath;
    }
    return normalizeRoot(viewsRoot) + iviewPath;
  }
  const folder = controllerNameToFolder(controllerName);
  const file = actionName.toLowerCase();
  return `${normalizeRoot(viewsRoot)}${folder}/${file}.tmvc`;
}

function normalizeRoot(viewsRoot: string): string {
  if (viewsRoot === '' || viewsRoot.endsWith('/')) return viewsRoot;
  return `${viewsRoot}/`;
}

function controllerNameToFolder(controllerName: string): string {
  const withoutSuffix = controllerName.endsWith('Controller')
    ? controllerName.slice(0, -'Controller'.length)
    : controllerName;
  return withoutSuffix.replace(/(?<=[a-z])([A-Z])/g, '-$1').toLowerCase();
}
