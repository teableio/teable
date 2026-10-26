import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  outDir: 'dist/bundle',
  tsconfig: 'tsconfig.build.json',
  format: ['cjs'],
  clean: true,
  sourcemap: false,
  minify: false,
  dts: false,
  noExternal: [/^@teable\/v2-/],
  outExtensions: () => ({ js: '.cjs' }),
});
