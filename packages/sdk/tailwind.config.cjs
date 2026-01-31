const { join } = require('path');
const uiConfig = require('@teable/ui-lib/ui.config.cjs');
const sdkPath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');
const buildFilePath = join(__dirname, './dist/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = uiConfig({
  content: [sdkPath, buildFilePath],
  darkMode: ['class'],
  theme: {
    extend: {
      keyframes: {
        scale: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(0.8)' },
        },
      },
    },
  },
  plugins: [],
});
