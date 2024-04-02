const { join } = require('path');
const uiConfig = require('@teable/ui-lib/ui.config.js');
const sdkPath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = uiConfig({
  content: [sdkPath],
  darkMode: ['class'],
  theme: {},
  plugins: [],
});
