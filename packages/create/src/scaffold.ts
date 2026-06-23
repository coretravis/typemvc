import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PROJECT_NAME_TOKEN = '{{projectName}}';

/** Options for a single scaffolding run. */
export interface ScaffoldOptions {
  /** Absolute path of the directory to create the app in. */
  readonly targetDir: string;
  /** Project name written into package.json and the page title. */
  readonly projectName: string;
  /** Absolute path of the template directory to copy from. */
  readonly templateDir: string;
  /** Allow writing into a non-empty target directory. Defaults to false. */
  readonly force?: boolean;
}

/** The result of a scaffolding run. */
export interface ScaffoldResult {
  /** Paths of the written files, relative to targetDir, using forward slashes. */
  readonly files: readonly string[];
}

/**
 * Copies the template tree into targetDir, replacing the project-name token and
 * renaming `_gitignore` to `.gitignore`. Throws if the target is non-empty and
 * force is not set.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const { targetDir, projectName, templateDir, force = false } = options;

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0 && !force) {
    throw new Error(
      `[TypeMVC] Target directory "${targetDir}" is not empty. ` +
        `Pass --force to scaffold into it anyway.`,
    );
  }

  mkdirSync(targetDir, { recursive: true });

  const written: string[] = [];
  copyDir(templateDir, targetDir, targetDir, projectName, written);
  return { files: written };
}

function copyDir(
  srcDir: string,
  destDir: string,
  rootDest: string,
  projectName: string,
  written: string[],
): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    if (entry.isDirectory()) {
      const subDest = join(destDir, entry.name);
      mkdirSync(subDest, { recursive: true });
      copyDir(srcPath, subDest, rootDest, projectName, written);
      continue;
    }
    const destName = entry.name === '_gitignore' ? '.gitignore' : entry.name;
    const destPath = join(destDir, destName);
    const content = readFileSync(srcPath, 'utf8').replaceAll(PROJECT_NAME_TOKEN, projectName);
    writeFileSync(destPath, content);
    written.push(relative(rootDest, destPath).split(sep).join('/'));
  }
}
