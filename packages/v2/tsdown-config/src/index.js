export const v2TsdownBaseConfig = {
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  external: [/^@teable\/v2-/, /^@teable\/formula$/],
  dts: {
    sourcemap: true,
  },
  clean: true,
  sourcemap: false,
  minify: false,
  treeshake: true,
  skipNodeModulesBundle: true,
  outExtensions() {
    return {
      js: '.js',
      dts: '.d.ts',
    };
  },
};
