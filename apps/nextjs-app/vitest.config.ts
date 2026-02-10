import react from '@vitejs/plugin-react-swc';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,jsx,ts,tsx}'];
export default defineConfig({
  resolve: {
    conditions: ['@teable/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@teable/source'],
      externalConditions: ['@teable/source'],
    },
  },
  plugins: [
    react({
      devTarget: 'es2022',
    }),
    tsconfigPaths(),
    svgr({
      // svgr options: https://react-svgr.com/docs/options/
      svgrOptions: {},
    }),
  ],
  cacheDir: '../../.cache/vitest/nextjs-app',
  test: {
    globals: true,
    environment: 'happy-dom',
    passWithNoTests: false,
    setupFiles: './config/tests/setupVitest.ts',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx,ts,tsx}', 'config/**/*.{js,jsx,ts,tsx}'],
    },
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
