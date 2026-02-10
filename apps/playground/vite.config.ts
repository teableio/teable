import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import viteTsConfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import type { PluginOption } from 'vite';

const v2ServerPackages = [
  // Core
  '@teable/v2-core',
  '@teable/v2-di',
  '@teable/v2-postgres-schema',
  '@teable/v2-table-templates',
  '@teable/v2-formula-sql-pg',
  // Contract
  '@teable/v2-contract-http',
  '@teable/v2-contract-http-client',
  '@teable/v2-contract-http-express',
  '@teable/v2-contract-http-fastify',
  '@teable/v2-contract-http-hono',
  '@teable/v2-contract-http-implementation',
  '@teable/v2-contract-http-openapi',
  // Containers
  '@teable/v2-container-browser',
  '@teable/v2-container-bun',
  '@teable/v2-container-bun-test',
  '@teable/v2-container-node',
  '@teable/v2-container-node-test',
  // DB Adapters
  '@teable/v2-adapter-db-postgres-bun-sql',
  '@teable/v2-adapter-db-postgres-pg',
  '@teable/v2-adapter-db-postgres-pglite',
  '@teable/v2-adapter-db-postgres-postgresjs',
  '@teable/v2-adapter-db-postgres-shared',
  // Repository Adapters
  '@teable/v2-adapter-repository-postgres',
  '@teable/v2-adapter-record-repository-postgres',
  '@teable/v2-adapter-table-repository-postgres',
  // Other Adapters
  '@teable/v2-adapter-bullmq',
  '@teable/v2-adapter-csv-parser-papaparse',
  '@teable/v2-adapter-logger-console',
  '@teable/v2-adapter-logger-pino',
  '@teable/v2-adapter-realtime-broadcastchannel',
  '@teable/v2-adapter-realtime-sharedb',
  '@teable/v2-adapter-realtime-yjs',
];
const sourceOnlyPackages = ['@teable/formula'];

const nodeExternalDeps = ['pg', 'pg-pool', 'kysely', '@electric-sql/pglite'];

const PLAYGROUND_PORT = 3100;
const v2PackagePrefix = '@teable/v2-';

const config = defineConfig(({ mode }) => {
  const envDir = path.dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const require = createRequire(import.meta.url);

  const tanstackStartEntryResolver = (): PluginOption => {
    const reactStartPkgDir = path.dirname(require.resolve('@tanstack/react-start/package.json'));
    const defaultClientEntry = path.resolve(
      reactStartPkgDir,
      'dist/plugin/default-entry/client.tsx'
    );
    const serverEntry = path.resolve(envDir, 'src/server.ts');

    const resolveVirtual = (id: string) => {
      if (
        id === 'virtual:tanstack-start-client-entry' ||
        id === '\0virtual:tanstack-start-client-entry'
      ) {
        return defaultClientEntry;
      }
      if (
        id === 'virtual:tanstack-start-server-entry' ||
        id === '\0virtual:tanstack-start-server-entry'
      ) {
        return serverEntry;
      }
      return null;
    };

    return {
      name: 'teable-playground:tanstack-start-entry-resolver',
      enforce: 'pre',
      resolveId(id) {
        return resolveVirtual(id);
      },
    };
  };

  const v2Aliases = v2ServerPackages.map(
    (pkg) =>
      ({
        find: pkg,
        replacement: path.resolve(
          envDir,
          `../../packages/v2/${pkg.slice(v2PackagePrefix.length)}/src/index.ts`
        ),
      }) as const
  );

  const teablePlaygroundAliases = (): PluginOption => ({
    name: 'teable-playground:aliases',
    enforce: 'post',
    config(viteConfig) {
      const existingAliases = Array.isArray(viteConfig.resolve?.alias)
        ? viteConfig.resolve.alias
        : viteConfig.resolve?.alias
          ? Object.entries(viteConfig.resolve.alias).map(([find, replacement]) => ({
              find,
              replacement,
            }))
          : [];

      return {
        resolve: {
          alias: [
            ...existingAliases,
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
      };
    },
  });
  if (!process.env.DATABASE_URL && env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  if (!process.env.PRISMA_DATABASE_URL && env.PRISMA_DATABASE_URL) {
    process.env.PRISMA_DATABASE_URL = env.PRISMA_DATABASE_URL;
  }
  if (!process.env.VITE_PLAYGROUND_DB_URL) {
    const defaultDbUrl = env.VITE_PLAYGROUND_DB_URL ?? env.DATABASE_URL;
    if (defaultDbUrl) {
      process.env.VITE_PLAYGROUND_DB_URL = defaultDbUrl;
    }
  }
  if (!process.env.PLAYGROUND_TRACE_LINK_BASE_URL && env.PLAYGROUND_TRACE_LINK_BASE_URL) {
    process.env.PLAYGROUND_TRACE_LINK_BASE_URL = env.PLAYGROUND_TRACE_LINK_BASE_URL;
  }

  return {
    envDir,
    plugins: [
      devtools(),
      tanstackStartEntryResolver(),
      // this is the plugin that enables path aliases
      viteTsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
      teablePlaygroundAliases(),
    ],
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
      host: true,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: PLAYGROUND_PORT,
      },
      fs: {
        // Allow TanStack Start's default entry modules under repo root `node_modules`.
        allow: [path.resolve(envDir, '../../..'), path.resolve(envDir, '../../../..')],
      },
    },
  };
});

export default config;
