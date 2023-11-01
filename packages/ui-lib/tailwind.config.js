const { join } = require('path');
const deepMerge = require('deepmerge');
const shadcnuiConfig = require('./tailwind.shadcnui.config');

const filePath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [filePath],
  darkMode: ['class'],
  theme: deepMerge({}, shadcnuiConfig.theme),
  plugins: [...shadcnuiConfig.plugins],
};
