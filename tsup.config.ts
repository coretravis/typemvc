import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/behaviors/index.ts',
    'src/vite-plugin/index.ts',
    'src/runtime-parser/index.ts',
    'src/volar-plugin/index.ts',
    'src/testing/index.ts',
    'src/testing/vitest.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
  outDir: 'dist',
  tsconfig: 'tsconfig.build.json',
  // vitest is the consumer's test runner; never bundle it into @typemvc/core/testing/vitest.
  external: ['vitest'],
  // __DEV__ is resolved by the consumer's bundler: Vite replaces process.env.NODE_ENV at
  // bundle time, making __DEV__ statically false in production so the minifier strips debug branches.
  banner: { js: 'var __DEV__=process.env.NODE_ENV!=="production";' },
});
