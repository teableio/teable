import { defineConfig } from 'tsdown';

/**
 * Bundles the embedded-PGlite entry for `bun build --compile`. PGlite's wasm
 * and data files are embedded by Bun at compile time (see
 * `scripts/build-bun-pglite.mjs`), not by this bundle.
 */
export default defineConfig({
  entry: ['src/embedded-pglite-cli.ts'],
  outDir: 'dist/bundle-pglite',
  tsconfig: 'tsconfig.build.json',
  format: ['cjs'],
  clean: true,
  sourcemap: false,
  minify: false,
  dts: false,
  noExternal: [/^@teable\/v2-/],
  outExtensions: () => ({ js: '.cjs' }),
});
