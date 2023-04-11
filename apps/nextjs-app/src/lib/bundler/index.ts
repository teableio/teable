import * as esbuild from 'esbuild-wasm';
import { PKG_CDN_HOST } from './config';
import { fetchPlugin } from './plugins/fetch-plugin';
import { unpkgPathPlugin } from './plugins/unpkg-path-plugin';

let service: Promise<void>;

const initEsbuild = async () => {
  if (!service) {
    service = esbuild.initialize({
      wasmURL: `${PKG_CDN_HOST}/esbuild-wasm@0.17.16/esbuild.wasm`,
      worker: true,
    });
  }
  await service;
};

export const esbuildRun = async (code: string) => {
  await initEsbuild();
  if (!service) {
    return;
  }
  console.log('esbuild compiling...');
  const result = await esbuild.build({
    entryPoints: ['index.js'],
    bundle: true,
    write: false,
    plugins: [unpkgPathPlugin(), fetchPlugin(code)],
    define: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'process.env.NODE_ENV': '"production"',
      global: 'window',
    },
    jsxFactory: '_React.createElement',
    jsxFragment: '_React.Fragment',
  });

  console.log('esbuild compilation completed');

  return result.outputFiles[0].text;
};
