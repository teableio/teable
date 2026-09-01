import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from './zod';

// Accepts `?key=a` and `?key=a&key=b` alike, normalizing to an array.
export const createStringOrArrayQuerySchema = <T extends z.ZodType<string>>(itemSchema: T) =>
  z
    .union([itemSchema, itemSchema.array()])
    .transform((val) => (typeof val === 'string' ? [val] : val))
    .optional()
    .meta({
      type: 'array',
      items: { type: 'string' },
    });

export const stringOrArrayQuerySchema = createStringOrArrayQuerySchema(z.string());

// Serializes query params where array values become repeated `key=value` pairs
// (the shape stringOrArrayQuerySchema expects on the server).
export const serializeArrayAwareQuery = (params?: Record<string, unknown>) => {
  const searchParams = new URLSearchParams();

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value == null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => searchParams.append(key, String(item)));
      return;
    }

    searchParams.append(key, String(value));
  });

  return searchParams.toString();
};

export const urlBuilder = (url: string, pathParams?: Record<string, unknown>) => {
  if (!pathParams) {
    return url;
  }

  Object.entries(pathParams).forEach(([key, value]) => {
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
