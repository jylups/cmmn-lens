import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['server/public/build/**', 'spikes/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  },
  {
    files: ['server/client/**/*.js'],
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    files: ['server/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser
    }
  }
];
