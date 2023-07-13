const { join } = require('path');
const uiConfig = require('@teable-group/ui-lib/ui.config.js');
const filePath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');
const sdkPath = join(__dirname, '../../packages/sdk/src/**/*.{js,ts,jsx,tsx}');
const uiLibPath = join(__dirname, '../../packages/ui-lib/src/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = uiConfig({
  content: [filePath, sdkPath, uiLibPath],
  darkMode: ['class'],
  theme: {},
  plugins: [],
});
