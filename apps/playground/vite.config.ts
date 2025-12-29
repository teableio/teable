import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';

const v2ServerPackages = [
  '@teable/v2-core',
  '@teable/v2-contract-http',
  '@teable/v2-contract-http-implementation',
  '@teable/v2-container-node',
  '@teable/v2-adapter-db-postgres-pg',
  '@teable/v2-adapter-db-postgres-pglite',
  '@teable/v2-adapter-db-postgres-shared',
  '@teable/v2-postgres-schema',
  '@teable/v2-adapter-repository-postgres',
  '@teable/v2-adapter-schema-repository-postgres',
  '@teable/v2-adapter-realtime-broadcastchannel',
  '@teable/v2-adapter-realtime-sharedb',
  '@teable/v2-di',
];
const sourceOnlyPackages = ['@teable/formula'];

const nodeExternalDeps = ['pg', 'pg-pool', 'kysely', '@electric-sql/pglite'];

const PLAYGROUND_PORT = 3100;
const v2PackagePrefix = '@teable/v2-';

const config = defineConfig(({ mode }) => {
  const envDir = path.dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const v2Aliases = v2ServerPackages.map((pkg) => ({
    find: pkg,
    replacement: path.resolve(
      envDir,
      `../../packages/v2/${pkg.slice(v2PackagePrefix.length)}/src/index.ts`
    ),
  }));
  if (!process.env.DATABASE_URL && env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  if (!process.env.PRISMA_DATABASE_URL && env.PRISMA_DATABASE_URL) {
    process.env.PRISMA_DATABASE_URL = env.PRISMA_DATABASE_URL;
  }

  return {
    envDir,
    plugins: [
      devtools(),
      nitro(),
      // this is the plugin that enables path aliases
      viteTsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
    resolve: {
      // Force v2 packages to resolve to source for dev without dist outputs.
      alias: [
        {
          find: '@teable/v2-contract-http-implementation/handlers',
          replacement: path.resolve(
            envDir,
            '../../packages/v2/contract-http-implementation/src/handlers/index.ts'
          ),
        },
        ...v2Aliases,
        {
          find: '@teable/formula',
          replacement: path.resolve(envDir, '../../packages/formula/src/index.ts'),
        },
      ],
    },
    ssr: {
      // Bundle v2 source in dev so we can run without dist outputs.
      noExternal: [...v2ServerPackages, ...sourceOnlyPackages],
      external: nodeExternalDeps,
    },
    optimizeDeps: {
      exclude: [...v2ServerPackages, ...sourceOnlyPackages, ...nodeExternalDeps],
    },
    server: {
      port: PLAYGROUND_PORT,
    },
  };
});

export default config;
