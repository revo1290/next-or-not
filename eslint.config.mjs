import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dataset/results-*.json'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'object-shorthand': 'error',
      'no-implicit-coercion': ['error', { boolean: false }],
      'no-throw-literal': 'error',
    },
  },
];
