export const v2TsdownBaseConfig = {
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['cjs'],
  external: [/^@teable\/v2-/],
  dts: true,
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
