// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.nitro/**',
      '**/node_modules/**',
      'extracted/**',
      'blueprint/**',
      'docs-reverse-engineered/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Browser snippets pasted into a page's console, not modules we build.
    files: ['docs/**/*.js'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', CSS: 'readonly', location: 'readonly' },
    },
  },
  {
    // Standalone Node scripts (run manually via bun), not part of the app build.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
)
