import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig } from 'eslint/config';
import eslintJs from '@eslint/js';
import tseslint from 'typescript-eslint';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(
  eslintJs.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs'],
          defaultProject: 'tsconfig.json',
        },
        tsconfigRootDir: rootDir,
      },
    },
  },
  {
    files: ['*.mjs', '*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // template/ is consumer app source (different tsconfig, decorators);
    // dist/ is build output. Neither is part of this package's lint surface.
    ignores: ['dist/**', 'node_modules/**', 'template/**'],
  },
);
