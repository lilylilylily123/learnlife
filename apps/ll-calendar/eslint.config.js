// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // PocketBase doesn't sanitize user input; never opt into raw HTML.
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
    },
  },
  {
    ignores: ['dist/*'],
  },
]);
