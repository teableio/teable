import react from '@vitejs/plugin-react-swc';
import svgr from 'vite-plugin-svgr';
import { configDefaults, defineConfig } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,jsx,ts,tsx}'];
export default defineConfig({
  plugins: [
    react({
      devTarget: 'es2022',
    }),
    svgr({
      // svgr options: https://react-svgr.com/docs/options/include: ['src/**/*'],
      svgrOptions: {},
    }),
  ],
  resolve: {
    conditions: ['@teable/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@teable/source'],
      externalConditions: ['@teable/source'],
    },
  },
  cacheDir: '../../.cache/vitest/sdk',
  test: {
    globals: true,
    environment: 'happy-dom',
    typecheck: {
      enabled: false,
    },
    passWithNoTests: false,
    setupFiles: './config/tests/setupVitest.ts',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx,ts,tsx}'],
    },
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});
