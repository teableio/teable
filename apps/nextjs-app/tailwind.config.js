const { join } = require('path');
const uiConfig = require('@teable-group/ui-lib/ui.config.js');
const filePath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = uiConfig({
  content: [filePath],
  darkMode: ['class'],
  theme: {},
  plugins: [],
});
