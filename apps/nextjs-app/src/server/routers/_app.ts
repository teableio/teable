import { router } from '../trpc';
import { ssrRouter } from './ssr';

export const appRouter = router({
  ssr: ssrRouter,
});

// export type definition of API
// eslint-disable-next-line @typescript-eslint/naming-convention
export type AppRouter = typeof appRouter;
