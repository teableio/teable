import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: true,
  },
  dts: {
    sourcemap: true,
  },
  clean: true,
  sourcemap: false,
  minify: false,
  treeshake: true,
  outExtensions({ format }) {
    const js = format === 'es' ? '.mjs' : '.cjs';
    return {
      js,
      dts: '.d.ts',
    };
  },
});
