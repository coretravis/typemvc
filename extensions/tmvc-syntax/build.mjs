import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../..');

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  minify: false,
};

// The VS Code extension host provides 'vscode' at runtime; never bundle it.
// 'typescript' is loaded dynamically by @volar/language-server via loadTsdkByPath,
// so it must remain an external require, not inlined.
const serverExternal = ['vscode', 'typescript'];

// The client runs in the extension host and only uses 'vscode' and the
// vscode-languageclient path helpers, both provided by VS Code.
const clientExternal = ['vscode'];

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/server.ts'],
    outfile: 'out/server.js',
    external: serverExternal,
    alias: {
      '@typemvc/core/volar': resolve(workspaceRoot, 'dist/volar-plugin/index.js'),
      '@typemvc/core/vite': resolve(workspaceRoot, 'dist/vite-plugin/index.js'),
    },
  }),
  build({
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    external: clientExternal,
  }),
]);

console.log('Build complete.');
