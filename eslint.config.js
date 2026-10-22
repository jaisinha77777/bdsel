// ESLint flat config: recommended JS rules + type-aware typescript-eslint rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'reports/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Fakes and fetcher adapters are often async without awaiting; that is intentional.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // The config file itself is plain JS; skip type-aware rules there.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
