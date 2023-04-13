import { createOpenApiNextHandler } from 'trpc-openapi';
import { appRouter } from 'server/routers/_app';

// export API handler
// @see https://trpc.io/docs/api-handler
export default createOpenApiNextHandler({
  router: appRouter,
  createContext: () => ({}),
});
