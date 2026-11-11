import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Layer rules from docs/BUILD-PLAN.md section 7.
const noImport = (names, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: names, message }] }],
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.tsbuild/**', 'data/**', 'art/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/domain/**'],
    rules: noImport(['@ai-erp/*'], 'domain is the bottom layer: it imports no other workspace.'),
  },
  {
    files: ['packages/core/**'],
    rules: noImport(
      ['@ai-erp/scene', '@ai-erp/client', '@ai-erp/api', 'pixi.js', 'react', 'react-dom'],
      'The core does not know about the game (CONTEXT principle 5).',
    ),
  },
  {
    files: ['packages/scene/**', 'apps/client/**'],
    rules: noImport(
      ['@ai-erp/core', '@ai-erp/core/*', '@ai-erp/api', '@ai-erp/api/*'],
      'No business logic in the client: read state from the API, share types via @ai-erp/domain.',
    ),
  },
);
