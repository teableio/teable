import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';

const v2ServerDeps = [
  '@teable/v2-core',
  '@teable/v2-contract-http',
  '@teable/v2-contract-http-implementation',
  '@teable/v2-container-node',
  '@teable/v2-adapter-db-postgres-pg',
  '@teable/v2-postgres-schema',
  '@teable/v2-adapter-repository-postgres',
  '@teable/v2-adapter-schema-repository-postgres',
  '@teable/v2-di',
  'pg',
  'pg-pool',
  'kysely',
];

const PLAYGROUND_PORT = 3100;

const config = defineConfig(({ mode }) => {
  const envDir = path.dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(mode, envDir, '');
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
    ssr: {
      // Force Node to load CJS v2 server packages instead of Vite's ESM runner.
      external: v2ServerDeps,
    },
    optimizeDeps: {
      exclude: v2ServerDeps,
    },
    server: {
      port: PLAYGROUND_PORT,
    },
  };
});

export default config;
