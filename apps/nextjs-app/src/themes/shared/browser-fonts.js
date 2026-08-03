// @ts-check
// Keep this file as '.js' as it's included in tailwind.config.js

/**
 * @type {{mono: string[], sans: string[], serif: string[]}}
 */
const browserFonts = {
  sans: [
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'Noto Sans',
    'sans-serif',
    'Apple Color Emoji',
    'Segoe UI Emoji',
    'Segoe UI Symbol',
    'Noto Color Emoji',
  ],
  serif: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
  mono: [
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Monaco',
    'Consolas',
    'Liberation Mono',
    'Courier New',
    'monospace',
  ],
};

module.exports = {
  browserFonts: browserFonts,
};
