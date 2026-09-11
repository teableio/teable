import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Permissions } from './decorators/permissions.decorator';
import { Public } from './decorators/public.decorator';
import { TokenAccess } from './decorators/token.decorator';
import type { IAnnotatedOperation } from './openapi-token-access';
import {
  annotateOpenApiTokenAccess,
  collectRouteAccess,
  normalizeRoutePath,
} from './openapi-token-access';

@Controller('api/table/:tableId/record')
class RecordController {
  @Permissions('record|read')
  @Get(':recordId')
  getRecord() {}

  // Permission is checked inside the service, so a bearer token is rejected
  // by the guard before the handler runs.
  @Patch(':recordId')
  updateRecord() {}

  @Permissions('record|delete')
  @Delete()
  deleteRecords() {}
}

@Controller('api/auth')
class AuthController {
  @Get('/user/me')
  me() {}

  @TokenAccess()
  @Get('/user')
  user() {}

  @Public()
  @Post('signin')
  signin() {}
}

// Class-level metadata applies to every handler, as Reflector.getAllAndOverride does.
@Permissions('space|read')
@Controller('api/space')
class SpaceController {
  @Get()
  list() {}
}

// EE-style override: inherits the parent's decorated handlers.
@Controller('api/table/:tableId/record')
class RecordOverrideController extends RecordController {
  @Permissions('record|update')
  @Patch(':recordId')
  updateRecord() {}
}

// Class-level @Public() with a handler whose own guard still authenticates.
@Public()
@TokenAccess()
@Controller('api/attachments')
class AttachmentsController {
  @Post('upload/:token')
  upload() {}

  @TokenAccess()
  @Post('signature')
  signature() {}
}

// EE registers its override next to the community module it imports; both
// serve the same route with different scopes.
@Controller('api/table/:tableId/aggregation')
class AggregationOverrideController {
  @Permissions('record|read')
  @Get()
  aggregation() {}
}

@Controller('api/table/:tableId/aggregation')
class AggregationController {
  @Permissions('table|read')
  @Get()
  aggregation() {}
}

const buildDoc = (paths: [string, string[]][]): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: Object.fromEntries(
    paths.map(([path, methods]) => [
      path,
      Object.fromEntries(
        methods.map((m) => [m, { description: 'desc', security: [{ bearerAuth: [] }] }])
      ),
    ])
  ),
});

const excluded = (operation: unknown) =>
  (operation as IAnnotatedOperation | undefined)?.['x-excluded'];

describe('normalizeRoutePath', () => {
  it('maps controller and openapi spellings of the same route to one key', () => {
    expect(normalizeRoutePath('api/table/:tableId/record', ':recordId')).toBe(
      normalizeRoutePath('/table/{tableId}/record/{id}')
    );
    expect(normalizeRoutePath('api/space', '/')).toBe('/space');
    expect(normalizeRoutePath('api')).toBe('/');
  });
});

describe('annotateOpenApiTokenAccess', () => {
  const routes = collectRouteAccess([RecordController, AuthController, SpaceController]);
  const doc = buildDoc([
    ['/table/{tableId}/record/{recordId}', ['get', 'patch']],
    ['/table/{tableId}/record', ['delete']],
    ['/auth/user/me', ['get']],
    ['/auth/user', ['get']],
    ['/auth/signin', ['post']],
    ['/space', ['get']],
    ['/stale/{id}', ['get']],
  ]);
  const stats = annotateOpenApiTokenAccess(doc, routes);

  it('marks session-only operations with cookieAuth and x-excluded, keeping them in the document', () => {
    const patch = doc.paths['/table/{tableId}/record/{recordId}'].patch;
    expect(patch?.security).toEqual([{ cookieAuth: [] }]);
    expect(excluded(patch)).toBe(true);
    expect(patch?.description).toContain('Session (cookie) authentication only');
    expect(excluded(doc.paths['/auth/user/me'].get)).toBe(true);
    expect(doc.components?.securitySchemes?.cookieAuth).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'auth_session',
    });
    expect(stats.cookieOnly).toBe(2);
  });

  it('keeps @Permissions, @TokenAccess and class-level @Permissions routes on bearerAuth with their scopes', () => {
    const get = doc.paths['/table/{tableId}/record/{recordId}'].get;
    expect(get?.security).toEqual([{ bearerAuth: [] }]);
    expect(excluded(get)).toBeUndefined();
    expect(get?.description).toContain('Required token scopes: `record|read`');
    expect(doc.paths['/table/{tableId}/record'].delete?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/auth/user'].get?.description).toBe('desc');
    expect(doc.paths['/space'].get?.description).toContain('`space|read`');
    expect(stats.token).toBe(4);
  });

  it('clears the security requirement on public routes', () => {
    expect(doc.paths['/auth/signin'].post?.security).toEqual([]);
    expect(stats.public).toBe(1);
  });

  it('leaves routes without a serving controller untouched and reports them', () => {
    expect(doc.paths['/stale/{id}'].get?.security).toEqual([{ bearerAuth: [] }]);
    expect(stats.unmatched).toEqual(['GET /stale/{id}']);
  });
});

describe('collectRouteAccess', () => {
  it('treats a handler-level @TokenAccess as authenticated despite class-level @Public', () => {
    const routes = collectRouteAccess([AttachmentsController]);
    expect(routes.get('post /attachments/upload/{}')?.isPublic).toBe(true);
    expect(routes.get('post /attachments/signature')).toEqual({
      tokenAccessible: true,
      isPublic: false,
      permissions: [],
    });
  });

  it('keeps the first registered controller for a route served by two controllers', () => {
    const routes = collectRouteAccess([AggregationOverrideController, AggregationController]);
    expect(routes.get('get /table/{}/aggregation')?.permissions).toEqual(['record|read']);
  });

  it('lets an override controller re-declare an inherited handler', () => {
    const routes = collectRouteAccess([RecordOverrideController]);
    expect(routes.get('patch /table/{}/record/{}')).toMatchObject({
      tokenAccessible: true,
      permissions: ['record|update'],
    });
    expect(routes.get('get /table/{}/record/{}')?.tokenAccessible).toBe(true);
  });
});
