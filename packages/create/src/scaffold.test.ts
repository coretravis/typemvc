import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold } from './scaffold.js';

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, '..', 'template');

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'typemvc-create-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('scaffold', () => {
  it('copies the full template tree into the target directory', () => {
    const target = join(tmp, 'app');
    const result = scaffold({ targetDir: target, projectName: 'my-app', templateDir });

    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'vite.config.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'main.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'controllers', 'HomeController.ts'))).toBe(true);
    expect(existsSync(join(target, 'src', 'views', 'home', 'index.tmvc'))).toBe(true);
    expect(result.files.length).toBeGreaterThan(5);
  });

  it('ships a component with a co-located stylesheet and a token file', () => {
    const target = join(tmp, 'app');
    scaffold({ targetDir: target, projectName: 'my-app', templateDir });

    const component = join(target, 'src', 'components', 'Badge.tmvc');
    expect(existsSync(component)).toBe(true);
    expect(existsSync(join(target, 'src', 'components', 'Badge.tmvc.css'))).toBe(true);
    expect(existsSync(join(target, 'src', 'styles', 'tokens.css'))).toBe(true);
  });

  it('replaces {{projectName}} in package.json and index.html', async () => {
    const target = join(tmp, 'app');
    scaffold({ targetDir: target, projectName: 'cool-app', templateDir });

    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('cool-app');

    const html = await readFile(join(target, 'index.html'), 'utf8');
    expect(html).toContain('<title>cool-app</title>');
    expect(html).not.toContain('{{projectName}}');
  });

  it('writes _gitignore as .gitignore and leaves no _gitignore behind', () => {
    const target = join(tmp, 'app');
    scaffold({ targetDir: target, projectName: 'g', templateDir });

    expect(existsSync(join(target, '.gitignore'))).toBe(true);
    expect(existsSync(join(target, '_gitignore'))).toBe(false);
  });

  it('refuses to write into a non-empty directory without force', async () => {
    const target = join(tmp, 'app');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'keep.txt'), 'hi');

    expect(() => scaffold({ targetDir: target, projectName: 'x', templateDir })).toThrow(/\[TypeMVC\]/);
  });

  it('writes into a non-empty directory when force is set', async () => {
    const target = join(tmp, 'app');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'keep.txt'), 'hi');

    scaffold({ targetDir: target, projectName: 'x', templateDir, force: true });

    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'keep.txt'))).toBe(true);
  });
});
