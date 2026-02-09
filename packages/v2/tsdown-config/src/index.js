export const v2TsdownBaseConfig = {
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  external: [/^@teable\/v2-/, /^@teable\/formula$/],
  dts: {
    sourcemap: true,
  },
  clean: true,
  sourcemap: false,
  minify: false,
  treeshake: true,
  skipNodeModulesBundle: true,
  outExtensions({ format }) {
    const js = format === 'cjs' ? '.cjs' : '.js';
    return {
      js,
      dts: '.d.ts',
    };
  },
};

export default v2TsdownBaseConfig;
