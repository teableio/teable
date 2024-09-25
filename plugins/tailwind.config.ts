import uiConfig from '@teable/sdk/ui.config';
import type { Config } from 'tailwindcss';

const config: Config = uiConfig({
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  plugins: [],
});
export default config;
