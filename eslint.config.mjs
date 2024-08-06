import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/coverage',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/explicit-module-boundary-types': 0,
      '@typescript-eslint/no-unused-vars': 0,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-expressions': 0,
    },
    files: [
      'test/*'
    ]
  }
);
