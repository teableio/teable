import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { IS_TOKEN_ACCESS } from './decorators/token.decorator';

type PathItemObject = OpenAPIObject['paths'][string];
type OperationObject = NonNullable<PathItemObject['get']>;
// Mintlify reads `x-excluded` to leave an operation out of the generated
// reference entirely (`x-hidden` would still build a page reachable by URL).
// eslint-disable-next-line @typescript-eslint/naming-convention
export type IAnnotatedOperation = OperationObject & { 'x-excluded'?: boolean };

export const BEARER_AUTH_SCHEME = 'bearerAuth';
export const COOKIE_AUTH_SCHEME = 'cookieAuth';

/**
 * Access-token reachability of a route, derived from the same decorator
 * metadata the permission guards read. A bearer token only passes the guards
 * on handlers that declare a non-empty `@Permissions(...)` or opt in with
 * `@TokenAccess()`; `@Public()` routes need no credentials at all.
 *
 * A handler-level `@TokenAccess()` under a class-level `@Public()` marks a
 * route whose auth is enforced by a route-specific guard the global guards
 * know nothing about (e.g. `/attachments/signature`): declaring token access
 * on a truly public route would be meaningless, so it means "authenticated,
 * token accepted". Only the handler's own metadata counts — an EE controller
 * carries both decorators at class level while its upload routes stay public.
 */
export interface IRouteAccess {
  tokenAccessible: boolean;
  isPublic: boolean;
  permissions: string[];
}

export interface ITokenAccessStats {
  token: number;
  cookieOnly: number;
  public: number;
  unmatched: string[];
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const REQUEST_METHOD_NAMES: Record<number, readonly HttpMethod[]> = {
  [RequestMethod.GET]: ['get'],
  [RequestMethod.POST]: ['post'],
  [RequestMethod.PUT]: ['put'],
  [RequestMethod.DELETE]: ['delete'],
  [RequestMethod.PATCH]: ['patch'],
  [RequestMethod.OPTIONS]: ['options'],
  [RequestMethod.HEAD]: ['head'],
  [RequestMethod.ALL]: HTTP_METHODS,
};

/**
 * Normalize a Nest controller path (`api/table/:tableId/record` + `:recordId`)
 * or an OpenAPI path (`/table/{tableId}/record/{recordId}`) to one comparable
 * key: leading `/api` stripped, parameter names erased (`/table/{}/record/{}`)
 * because controllers and the OpenAPI registry do not always name them alike.
 */
export const normalizeRoutePath = (...segments: string[]): string => {
  let path = ('/' + segments.join('/')).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  if (path === '/api') {
    path = '/';
  } else if (path.startsWith('/api/')) {
    path = path.slice('/api'.length);
  }
  return path.replace(/:\w+\??/g, '{}').replace(/\{[^}]*\}/g, '{}');
};

const routeKey = (method: string, path: string) => `${method} ${normalizeRoutePath(path)}`;

const toArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' ? [value] : [];
};

// Mirrors Reflector.getAllAndOverride(key, [handler, class]).
const getOverride = <T>(key: string, handler: object, cls: object): T | undefined => {
  const own = Reflect.getMetadata(key, handler) as T | undefined;
  return own !== undefined ? own : (Reflect.getMetadata(key, cls) as T | undefined);
};

const readHandlerAccess = (cls: object, handler: object): IRouteAccess => {
  const permissions = getOverride<string[]>(PERMISSIONS_KEY, handler, cls) ?? [];
  const tokenAccess = Boolean(getOverride<boolean>(IS_TOKEN_ACCESS, handler, cls));
  const ownTokenAccess = Boolean(Reflect.getMetadata(IS_TOKEN_ACCESS, handler));
  const isPublic = !ownTokenAccess && Boolean(getOverride<boolean>(IS_PUBLIC_KEY, handler, cls));
  return { tokenAccessible: permissions.length > 0 || tokenAccess, isPublic, permissions };
};

const handlerRouteKeys = (
  controllerPaths: string[],
  handler: object,
  requestMethod: number
): string[] => {
  const handlerPaths = toArray(Reflect.getMetadata(PATH_METADATA, handler));
  const keys: string[] = [];
  for (const controllerPath of controllerPaths) {
    for (const handlerPath of handlerPaths.length ? handlerPaths : ['/']) {
      for (const method of REQUEST_METHOD_NAMES[requestMethod] ?? []) {
        keys.push(routeKey(method, `${controllerPath}/${handlerPath}`));
      }
    }
  }
  return keys;
};

const collectControllerRoutes = (
  cls: Type<unknown>,
  scanner: MetadataScanner,
  routes: Map<string, IRouteAccess>
) => {
  const controllerPaths = toArray(Reflect.getMetadata(PATH_METADATA, cls));
  if (!controllerPaths.length) return;
  const prototype = cls.prototype as Record<string, unknown>;

  for (const name of scanner.getAllMethodNames(prototype)) {
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    if (requestMethod === undefined) continue;

    const access = readHandlerAccess(cls, handler);
    for (const key of handlerRouteKeys(controllerPaths, handler, requestMethod)) {
      // Express dispatches to the first registered handler for a path, and
      // controllers are registered in ModulesContainer order — the order the
      // caller passes here. So when two controllers serve the same route (EE
      // override + the community module it imports), the first one wins.
      if (!routes.has(key)) routes.set(key, access);
    }
  }
};

/**
 * Walk controller classes, in registration order, and index every HTTP
 * handler by `method path` key. Handlers inherited from a parent controller
 * are included, so EE override controllers that extend the community ones are
 * covered.
 */
export const collectRouteAccess = (controllers: Type<unknown>[]): Map<string, IRouteAccess> => {
  const scanner = new MetadataScanner();
  const routes = new Map<string, IRouteAccess>();
  for (const cls of controllers) {
    collectControllerRoutes(cls, scanner, routes);
  }
  return routes;
};

export const getAppControllers = (app: INestApplication): Type<unknown>[] => {
  const controllers: Type<unknown>[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (typeof wrapper.metatype === 'function') {
        controllers.push(wrapper.metatype as Type<unknown>);
      }
    }
  }
  return controllers;
};

const appendDescription = (description: string | undefined, line: string) =>
  description ? `${description}\n\n${line}` : line;

const annotateOperation = (
  operation: OperationObject,
  access: IRouteAccess,
  stats: ITokenAccessStats
) => {
  if (access.isPublic) {
    operation.security = [];
    stats.public++;
    return;
  }
  if (!access.tokenAccessible) {
    // Session-only: unreachable with an access token. `x-excluded` keeps the
    // operation out of the Mintlify-generated public API reference.
    operation.security = [{ [COOKIE_AUTH_SCHEME]: [] }];
    (operation as IAnnotatedOperation)['x-excluded'] = true;
    operation.description = appendDescription(
      operation.description,
      'Session (cookie) authentication only. Not callable with an access token.'
    );
    stats.cookieOnly++;
    return;
  }
  operation.security = [{ [BEARER_AUTH_SCHEME]: [] }];
  if (access.permissions.length) {
    const scopes = access.permissions.map((p) => `\`${p}\``).join(', ');
    operation.description = appendDescription(
      operation.description,
      `Required token scopes: ${scopes}`
    );
  }
  stats.token++;
};

/**
 * Annotate every operation in place with how it can be authenticated:
 * bearer token (with the scopes it needs), session cookie only (also marked
 * `x-excluded` for the public docs), or no credentials. Routes the registry
 * knows but no controller serves are left untouched and reported in
 * `unmatched`.
 */
export const annotateOpenApiTokenAccess = (
  document: OpenAPIObject,
  routes: Map<string, IRouteAccess>
): ITokenAccessStats => {
  const stats: ITokenAccessStats = { token: 0, cookieOnly: 0, public: 0, unmatched: [] };

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const access = routes.get(routeKey(method, path));
      if (!access) {
        stats.unmatched.push(`${method.toUpperCase()} ${path}`);
        continue;
      }
      annotateOperation(operation, access, stats);
    }
  }

  if (stats.cookieOnly) {
    document.components ??= {};
    document.components.securitySchemes ??= {};
    document.components.securitySchemes[COOKIE_AUTH_SCHEME] = {
      type: 'apiKey',
      in: 'cookie',
      name: AUTH_SESSION_COOKIE_NAME,
    };
  }
  return stats;
};

export const annotateAppOpenApiTokenAccess = (app: INestApplication, document: OpenAPIObject) =>
  annotateOpenApiTokenAccess(document, collectRouteAccess(getAppControllers(app)));
