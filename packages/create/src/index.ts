#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from './scaffold.js';

interface CliOptions {
  readonly dir: string | undefined;
  readonly name: string | undefined;
  readonly force: boolean;
  readonly git: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: readonly string[]): CliOptions {
  let dir: string | undefined;
  let name: string | undefined;
  let force = false;
  let git = true;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--no-git') {
      git = false;
    } else if (arg === '--name') {
      name = argv[i + 1];
      i++;
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else if (!arg.startsWith('-') && dir === undefined) {
      dir = arg;
    } else {
      throw new Error(`[TypeMVC] Unknown argument "${arg}". Run with --help for usage.`);
    }
  }

  return { dir, name, force, git, help, version };
}

function readVersion(): string {
  const raw = readFileSync(join(here, '..', 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? '0.0.0';
}

function detectPackageManager(): string {
  const ua = process.env.npm_config_user_agent;
  if (ua === undefined || ua === '') return 'npm';
  const name = ua.split(' ')[0]?.split('/')[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'bun') return name;
  return 'npm';
}

function printHelp(): void {
  console.log(
    [
      'Create a new TypeMVC app.',
      '',
      'Usage:',
      '  npm create @typemvc@latest <dir> [options]',
      '',
      'Options:',
      '  --name <name>   Project name (default: target directory name)',
      '  --force, -f     Scaffold into a non-empty directory',
      '  --no-git        Do not run git init',
      '  --help, -h      Show this help',
      '  --version, -v   Show the version',
    ].join('\n'),
  );
}

function tryGitInit(targetDir: string): void {
  const result = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
  if (result.status !== 0) {
    console.warn('[TypeMVC] Skipped git init (git not available or failed).');
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    console.log(readVersion());
    return;
  }
  if (options.dir === undefined) {
    throw new Error(
      '[TypeMVC] Please specify the target directory. ' +
        'Example: npm create @typemvc@latest my-app',
    );
  }

  const targetDir = resolve(process.cwd(), options.dir);
  const projectName = options.name ?? basename(targetDir);

  if (projectName === '' || projectName.includes('/') || projectName.includes('\\')) {
    throw new Error(
      `[TypeMVC] Invalid project name "${projectName}". ` +
        `Provide a valid name with --name, or use a directory name without path separators.`,
    );
  }

  const result = scaffold({
    targetDir,
    projectName,
    templateDir: join(here, '..', 'template'),
    force: options.force,
  });

  if (options.git) {
    tryGitInit(targetDir);
  }

  const pm = detectPackageManager();
  console.log(`\nScaffolded ${String(result.files.length)} files into ${targetDir}\n`);
  console.log('Next steps:');
  console.log(`  cd ${options.dir}`);
  console.log(`  ${pm} install`);
  console.log(`  ${pm} run dev\n`);
}

try {
  main();
} catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.message);
  process.exitCode = 1;
}
