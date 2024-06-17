const { join } = require('path');
const deepMerge = require('deepmerge');
const shadcnuiConfig = require('./tailwind.shadcnui.config');

const filePath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');
const buildFilePath = join(__dirname, './dist/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [filePath, buildFilePath],
  darkMode: ['class'],
  theme: deepMerge(
    {
      extend: {
        colors: {
          warning: 'hsl(var(--warning))',
          'warning-foreground': 'hsl(var(--warning-foreground))',
        },
      },
    },
    shadcnuiConfig.theme
  ),
  plugins: [...shadcnuiConfig.plugins],
};
