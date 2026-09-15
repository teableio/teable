import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getOpenApiDocumentation, getRoutes, registerRoute } from './index';

const registeredRoutes = [...getRoutes()];
const projectGroups = [
  ['base', 'project'],
  ['base node', 'project node'],
  ['base-share', 'project-share'],
];
const projectTags = projectGroups.map(([tag]) => tag);

// Mintlify derives URLs from method/path, tags, and summary. Extend this baseline when
// publishing new routes to protect their URLs; changes to existing entries need explicit review.
const existingProjectUrlInputs: [RouteConfig['method'], string, string | undefined][] = [
  ['post', '/base', undefined],
  ['delete', '/base/{baseId}', undefined],
  ['get', '/base/{baseId}', undefined],
  ['patch', '/base/{baseId}', undefined],
  ['post', '/base/{baseId}/collaborator', undefined],
  ['delete', '/base/{baseId}/collaborators', undefined],
  ['get', '/base/{baseId}/collaborators', undefined],
  ['patch', '/base/{baseId}/collaborators', undefined],
  ['get', '/base/{baseId}/collaborators/users', 'Get project collaborator user list'],
  [
    'get',
    '/base/{baseId}/duplicate-check',
    'Check cross-space affected fields for project duplicate',
  ],
  ['get', '/base/{baseId}/erd', undefined],
  ['get', '/base/{baseId}/export', undefined],
  ['get', '/base/{baseId}/export-stream', undefined],
  ['post', '/base/{baseId}/invitation/email', undefined],
  ['get', '/base/{baseId}/invitation/link', undefined],
  ['post', '/base/{baseId}/invitation/link', undefined],
  ['delete', '/base/{baseId}/invitation/link/{invitationId}', undefined],
  ['patch', '/base/{baseId}/invitation/link/{invitationId}', undefined],
  ['put', '/base/{baseId}/move', 'move a project to another space'],
  ['get', '/base/{baseId}/move-check', 'Check cross-space affected fields for project move'],
  ['get', '/base/{baseId}/move-job/{jobId}', 'Get project data DB move job status'],
  ['post', '/base/{baseId}/move-job/{jobId}/cancel', 'Cancel project data DB move job'],
  ['post', '/base/{baseId}/move-job/{jobId}/retry', 'Retry project data DB move job'],
  ['put', '/base/{baseId}/order', undefined],
  ['delete', '/base/{baseId}/permanent', undefined],
  ['get', '/base/{baseId}/permission', undefined],
  ['put', '/base/{baseId}/personal-order', undefined],
  ['post', '/base/{baseId}/publish', 'publish or unpublish a project'],
  ['get', '/base/access/all', 'Get all project list'],
  [
    'post',
    '/base/create-from-template',
    'Create a project from template or apply a template to a project',
  ],
  ['post', '/base/duplicate', undefined],
  ['post', '/base/duplicate-stream', undefined],
  ['post', '/base/import', 'import a project'],
  ['post', '/base/import-airtable/analyze', 'analyze an Airtable import source'],
  ['post', '/base/import-airtable/stream', 'import an Airtable base with SSE progress events'],
  ['post', '/base/import-google-sheet/analyze', 'analyze a Google Sheets import source'],
  ['get', '/base/import-google-sheet/picker-config', 'get Google Picker client config'],
  [
    'post',
    '/base/import-google-sheet/stream',
    'import a Google spreadsheet with SSE progress events',
  ],
  ['post', '/base/import-stream', 'import a project with SSE progress events'],
  ['delete', '/base/personal-order/{spaceId}', undefined],
  ['get', '/base/shared-base', undefined],
  ['get', '/space/{spaceId}/base', undefined],
  ['delete', '/trash/reset-items', undefined],
];

const existingProjectNodeAndShareUrlInputs: [RouteConfig['method'], string, string][] = [
  ['get', '/base/{baseId}/node/{nodeId}', 'base node'],
  ['put', '/base/{baseId}/node/{nodeId}', 'base node'],
  ['delete', '/base/{baseId}/node/{nodeId}', 'base node'],
  ['get', '/base/{baseId}/node/tree', 'base node'],
  ['get', '/base/{baseId}/node/list', 'base node'],
  ['put', '/base/{baseId}/node/{nodeId}/move', 'base node'],
  ['post', '/base/{baseId}/node/folder', 'base node'],
  ['post', '/base/{baseId}/node', 'base node'],
  ['post', '/base/{baseId}/node/{nodeId}/duplicate', 'base node'],
  ['delete', '/base/{baseId}/node/{nodeId}/permanent', 'base node'],
  ['patch', '/base/{baseId}/node/folder/{folderId}', 'base node'],
  ['delete', '/base/{baseId}/node/folder/{folderId}', 'base node'],
  ['post', '/base/{baseId}/share', 'base-share'],
  ['get', '/base/{baseId}/share', 'base-share'],
  ['patch', '/base/{baseId}/share/{shareId}', 'base-share'],
  ['delete', '/base/{baseId}/share/{shareId}', 'base-share'],
  ['post', '/base/{baseId}/share/{shareId}/refresh', 'base-share'],
  ['get', '/share/{shareId}/base', 'base-share'],
  ['get', '/base/{baseId}/share/node/{nodeId}', 'base-share'],
  ['post', '/share/{shareId}/base/auth', 'base-share'],
  ['post', '/share/{shareId}/base/copy', 'base-share'],
];

describe('Project API display generation', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    document = await getOpenApiDocumentation({ tags: projectTags });
  });

  afterEach(() => {
    getRoutes().splice(0, getRoutes().length, ...registeredRoutes);
  });

  it('requires display copy for every registered project operation', () => {
    const projectRoutes = registeredRoutes.filter((route) =>
      projectTags.includes(route.tags?.[0] ?? '')
    );
    expect(projectRoutes.length).toBeGreaterThan(0);
    expect(document.tags).toEqual(
      projectGroups.map(([name, displayName]) => ({ name, 'x-group': displayName }))
    );

    for (const route of projectRoutes) {
      const label = `${route.method.toUpperCase()} ${route.path}`;
      expect(route.title?.trim(), `${label} needs a title`).toBeTruthy();
      expect(route.description?.trim(), `${label} needs a description`).toBeTruthy();
      const operation = document.paths[route.path]?.[route.method];
      expect(operation?.['x-mint']?.metadata, label).toMatchObject({
        title: route.title,
        sidebarTitle: route.sidebarTitle ?? route.title,
        description: route.description,
      });
      expect(operation, label).not.toHaveProperty('title');
      expect(operation, label).not.toHaveProperty('sidebarTitle');
    }
  });

  it.each(existingProjectUrlInputs)(
    'preserves the URL inputs for %s %s',
    (method, path, summary) => {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.tags).toEqual(['base']);
      expect(operation?.summary).toBe(summary);
    }
  );

  it.each(existingProjectNodeAndShareUrlInputs)(
    'preserves the URL inputs for %s %s in %s',
    (method, path, tag) => {
      const operation = document.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.tags).toEqual([tag]);
      expect(operation?.summary).toBeUndefined();
    }
  );

  it.each(projectGroups)(
    'automatically gives a new %s operation its display copy',
    async (tag, displayName) => {
      const route = registerRoute({
        method: 'post',
        path: '/base/test-new-operation',
        tags: [tag],
        title: 'Archive project',
        description: 'Archive a project.',
        responses: { 200: { description: 'Archived' } },
      });

      const generated = await getOpenApiDocumentation({ paths: [route.path] });
      expect(generated.tags).toEqual([{ name: tag, 'x-group': displayName }]);
      expect(generated.paths[route.path].post).toMatchObject({
        tags: [tag],
        description: route.description,
        'x-mint': {
          metadata: {
            title: route.title,
            sidebarTitle: route.title,
            description: route.description,
          },
        },
      });
      expect(generated.paths[route.path].post).not.toHaveProperty('summary');
      expect(generated.paths[route.path].post).not.toHaveProperty('title');
      expect(generated.paths[route.path].post).not.toHaveProperty('sidebarTitle');
      expect(route).not.toHaveProperty('x-mint');
    }
  );

  it('preserves custom Mintlify metadata and keeps source display fields out of OpenAPI', async () => {
    const mintMetadata = {
      content: 'Custom operation content',
      metadata: { title: 'Old label', icon: 'archive' },
    };
    const route = registerRoute({
      method: 'post',
      path: '/base/test-custom-operation',
      tags: ['base'],
      summary: 'Existing base operation slug',
      title: 'Archive project',
      sidebarTitle: 'Archive',
      description: 'Archive a project.',
      'x-mint': mintMetadata,
      responses: { 200: { description: 'Archived' } },
    });

    const generated = await getOpenApiDocumentation({ paths: [route.path] });
    const operation = generated.paths[route.path].post;
    expect(operation?.['x-mint']).toEqual({
      content: mintMetadata.content,
      metadata: {
        icon: 'archive',
        title: 'Archive project',
        sidebarTitle: 'Archive',
        description: 'Archive a project.',
      },
    });
    expect(operation?.summary).toBe('Existing base operation slug');
    expect(operation).not.toHaveProperty('title');
    expect(operation).not.toHaveProperty('sidebarTitle');
    expect(route['x-mint']).toEqual(mintMetadata);
    expect(route['x-mint'].metadata.title).toBe('Old label');
  });

  it('supports display copy outside the project group without adding that group', async () => {
    const route = registerRoute({
      method: 'post',
      path: '/table/test-new-operation',
      tags: ['table'],
      title: 'Archive table',
      sidebarTitle: 'Archive',
      description: 'Archive a table.',
      responses: { 200: { description: 'Archived' } },
    });

    const generated = await getOpenApiDocumentation({ paths: [route.path] });
    const operation = generated.paths[route.path].post;
    expect(operation?.['x-mint']?.metadata).toEqual({
      title: 'Archive table',
      sidebarTitle: 'Archive',
      description: 'Archive a table.',
    });
    expect(operation?.tags).toEqual(['table']);
    expect(operation).not.toHaveProperty('title');
    expect(operation).not.toHaveProperty('sidebarTitle');
    expect(generated.tags).toBeUndefined();
  });

  it('leaves legacy unrelated operations and schemas without display fields unchanged', async () => {
    const unrelatedRoutes = registeredRoutes.filter(
      (route) =>
        route.tags?.[0] !== 'base' && route.title === undefined && route.sidebarTitle === undefined
    );
    getRoutes().splice(0, getRoutes().length, ...unrelatedRoutes);
    const registry = new OpenAPIRegistry();
    registry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
    });
    for (const route of unrelatedRoutes) {
      registry.registerPath({ ...route, security: [{ bearerAuth: [] }] });
    }
    const original = new OpenApiGeneratorV3(registry.definitions).generateDocument({
      openapi: '3.0.0',
      info: { version: '1.0.0', title: 'Teable App' },
    });
    const generated = await getOpenApiDocumentation({});

    expect(generated.paths).toEqual(original.paths);
    expect(generated.components).toEqual(original.components);
    expect(generated.tags).toBeUndefined();
  }, 60_000);
});
