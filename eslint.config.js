import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/.wrangler',
      '**/test-results',
      '**/playwright-report',
      'apps/client/public',
      'docs/**',
      '.superpowers/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/sim.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use rng.ts' },
        { object: 'Date', property: 'now', message: 'Engine must be deterministic' },
      ],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'phaser', 'phaser/*'] }],
    },
  },
);
