import type * as esbuild from 'esbuild-wasm';
import { PKG_CDN_HOST } from '../config';

export const unpkgPathPlugin = () => {
  return {
    name: 'unpkg-path-plugin',
    setup(build: esbuild.PluginBuild) {
      // Handle root entry file of 'index.js'
      // Regex : if(args.path === index.js)
      build.onResolve({ filter: /(^index\.js$)/ }, () => {
        return { path: 'index.js', namespace: 'a' };
      });

      // Handle relative paths in a module
      // Regex : if (args.path.includes('./') || args.path.includes('../'))
      build.onResolve({ filter: /^\.+\// }, (args) => {
        return {
          namespace: 'a',
          path: new URL(args.path, PKG_CDN_HOST + args.resolveDir + '/').href,
        };
      });

      // Handle main file of a module
      build.onResolve({ filter: /.*/ }, async (args) => {
        return {
          namespace: 'a',
          path: `${PKG_CDN_HOST}/${args.path}`,
        };
      });
    },
  };
};
