const { join } = require('path');
const uiConfig = require('@teable/ui-lib/ui.config.js');
const sdkPath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');
const buildFilePath = join(__dirname, './dist/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = uiConfig({
  content: [sdkPath, buildFilePath],
  darkMode: ['class'],
  theme: {},
  plugins: [],
});
