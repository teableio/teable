import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { z } from 'zod';

// Express 5's installed router is authoritative. Discovery alone also includes controllers
// that are not installed, and in enterprise multiple controllers declare the same route.
const routerSchema = z.object({
  stack: z.array(
    z.object({
      route: z
        .object({
          path: z.union([z.string(), z.array(z.string())]),
          methods: z.record(z.string(), z.boolean()),
        })
        .optional(),
    })
  ),
});

export interface IRegisteredRoute {
  key: string;
  path: string;
  /** Candidates for scope/diagnostics only; this does not identify the winning handler. */
  controllers: string[];
}

const declarationKeys = (metatype: object, target: object): string[] => {
  const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, target);
  if (method === undefined) return [];
  const prefixes = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, metatype) ?? '/');
  const paths = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, target) ?? '/');
  return prefixes.flatMap((prefix) =>
    paths.map((path) => {
      const full = `/${[prefix, path].join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      return `${RequestMethod[method]} ${full}`;
    })
  );
};

const declaredControllers = (app: INestApplication): Map<string, string[]> => {
  const scanner = new MetadataScanner();
  const declarations = new Map<string, string[]>();
  for (const { metatype, instance } of app.get(DiscoveryService).getControllers()) {
    if (!metatype || !instance) continue;
    const proto = Object.getPrototypeOf(instance);
    for (const handler of scanner.getAllMethodNames(proto)) {
      for (const key of declarationKeys(metatype, proto[handler])) {
        const candidates = declarations.get(key) ?? [];
        if (!candidates.includes(metatype.name)) candidates.push(metatype.name);
        declarations.set(key, candidates);
      }
    }
  }
  return declarations;
};

const installedRoutes = (router: z.infer<typeof routerSchema>): Map<string, IRegisteredRoute> => {
  const routes = new Map<string, IRegisteredRoute>();
  for (const { route } of router.stack) {
    if (!route) continue;
    const paths = Array.isArray(route.path) ? route.path : [route.path];
    const methods = Object.entries(route.methods)
      .filter(([, registered]) => registered)
      .map(([verb]) => (verb === '_all' ? 'ALL' : verb.toUpperCase()));
    for (const method of methods) {
      for (const path of paths) {
        const key = `${method} ${path}`;
        if (!routes.has(key)) routes.set(key, { key, path, controllers: [] });
      }
    }
  }
  return routes;
};

/** Call after app.listen(): this includes oRPC's bootstrap-installed routes. */
export const collectRegisteredRoutes = (app: INestApplication): Map<string, IRegisteredRoute> => {
  const server: unknown = app.getHttpAdapter().getInstance();
  if (!server || typeof server !== 'function' || !('router' in server)) {
    throw new Error('Route inventory requires a booted Express 5 application');
  }
  const router = server.router;
  if (!router || typeof router !== 'function' || !('stack' in router)) {
    throw new Error('Route inventory requires an installed Express 5 router stack');
  }
  const routes = installedRoutes(routerSchema.parse({ stack: router.stack }));
  const declarations = declaredControllers(app);
  for (const [key, route] of routes) route.controllers = declarations.get(key) ?? [];
  return routes;
};
