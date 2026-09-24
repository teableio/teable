import { defineConfig } from '@eloqnt/cli';

export default defineConfig({
  messages: {
    path: './src/locales/{locale}/{namespace}',
    locales: 'infer',
    sourceLocale: 'en',
    format: {
      codec: '@eloqnt/format-i18next-json',
      extension: '.json',
    },
  },
  lint: {
    overrides: [
      {
        // zh deliberately uses a slightly different wording
        keys: 'sdk.filter.displayLabel',
        locales: ['zh'],
        rules: { 'inconsistent-args': 'off' },
      },
    ],
  },
});
