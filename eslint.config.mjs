// Flat config for the whole monorepo. Type-aware rules stay off: `tsc --noEmit` already checks types, and the
// lint job has to stay fast.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Modules that do IO; core and services are pure functions, the CLI and the proxy do the IO. */
const IO_MODULES = ['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'http2', 'dgram', 'dns', 'os', 'worker_threads', 'cluster'].flatMap((m) => [m, `node:${m}`]);

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.turbo/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    files: ['packages/core/src/**/*.ts', 'packages/services/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: IO_MODULES.map((name) => ({ name, message: 'core and services are pure: IO belongs in packages/cli or packages/proxy' })) }],
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', 'scripts/**'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
