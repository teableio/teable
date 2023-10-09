import type { RouteConfig } from '@asteasolutions/zod-to-openapi';

export const urlBuilder = (url: string, params?: Record<string, unknown>) => {
  if (!params) {
    return url;
  }

  Object.entries(params).forEach(([key, value]) => {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  });
  return url;
};

const routes: RouteConfig[] = [];

export const registerRoute = (route: RouteConfig) => {
  routes.push(route);
  return route;
};

export const getRoutes = () => {
  return routes;
};
