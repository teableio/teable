const disableDts = process.env.TEABLE_TSDOWN_DISABLE_DTS === '1';

export const v2TsdownBaseConfig = {
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: true,
    // Only v2 packages and formula ship their own dists. Other workspace packages are inlined
    // into the JS, while the declarations import their types by package name.
    alwaysBundle: [/^@teable\/(?!v2-|formula$)/],
    dts: { alwaysBundle: [] },
  },
  dts: disableDts
    ? false
    : {
        sourcemap: true,
      },
  clean: true,
  sourcemap: false,
  minify: false,
  treeshake: true,
  outExtensions({ format }) {
    const js = format === 'cjs' ? '.cjs' : '.js';
    return {
      js,
      dts: '.d.ts',
    };
  },
};

export default v2TsdownBaseConfig;
