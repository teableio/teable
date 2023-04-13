import { generateOpenApiDocument } from 'trpc-openapi';
import { router } from '../trpc';
import { ssrRouter } from './ssr';
import { tableRouter } from './table';

export const appRouter = router({
  ssr: ssrRouter,
  table: tableRouter,
});

// export type definition of API
// eslint-disable-next-line @typescript-eslint/naming-convention
export type AppRouter = typeof appRouter;

/* 👇 */
export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'tRPC OpenAPI',
  version: '1.0.0',
  baseUrl: 'http://localhost:3000',
});
