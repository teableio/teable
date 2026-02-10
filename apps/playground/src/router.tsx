import { AnyRouter, createRouter, Link } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import NProgress from 'nprogress';
import * as TanstackQuery from './integrations/tanstack-query/root-provider';

// Import the generated route tree
import { routeTree } from './routeTree.gen';

const DefaultNotFoundComponent = () => (
  <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
    <div className="max-w-xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        Not Found
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">We couldn't find that page.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The link might be broken or the base no longer exists.
      </p>
      <div className="mt-6 flex justify-center">
        <Link
          to="/"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition hover:bg-primary/90"
        >
          Back to playground
        </Link>
      </div>
    </div>
  </div>
);

let isNProgressSetup = false;

const setupNProgress = (router: AnyRouter) => {
  if (import.meta.env.SSR || isNProgressSetup) return;
  isNProgressSetup = true;
  NProgress.configure({ showSpinner: false });

  let pendingNavigations = 0;
  const start = () => {
    if (pendingNavigations === 0) {
      NProgress.start();
    }
    pendingNavigations += 1;
  };
  const done = () => {
    if (pendingNavigations === 0) return;
    pendingNavigations -= 1;
    if (pendingNavigations === 0) {
      NProgress.done();
    }
  };

  router.subscribe('onBeforeNavigate', (event) => {
    if (!event.pathChanged && !event.hrefChanged) return;
    start();
  });
  router.subscribe('onResolved', done);
  router.subscribe('onRendered', done);
};

// Create a new router instance
export const getRouter = () => {
  const rqContext = TanstackQuery.getContext();

  const router = createRouter({
    routeTree,
    context: { ...rqContext },
    defaultPreload: 'intent',
    defaultNotFoundComponent: DefaultNotFoundComponent,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: rqContext.queryClient });
  setupNProgress(router);

  return router;
};
