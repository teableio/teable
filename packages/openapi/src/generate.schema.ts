import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import OpenAPISnippet from './openapi-snippet';
import { getRoutes } from './utils';

function registerRoutes(filters?: { tags?: string[]; paths?: string[]; methods?: string[] }) {
  const registry = new OpenAPIRegistry();
  const routeObjList: RouteConfig[] = getRoutes();

  let filteredRoutes = routeObjList;

  if (filters?.tags?.length) {
    filteredRoutes = filteredRoutes.filter(
      (route) => route.tags && route.tags.some((tag) => filters.tags!.includes(tag))
    );
  }

  if (filters?.paths?.length) {
    filteredRoutes = filteredRoutes.filter(
      (route) => route.path && filters.paths!.includes(route.path)
    );
  }

  if (filters?.methods?.length) {
    filteredRoutes = filteredRoutes.filter(
      (route) => route.method && filters.methods!.includes(route.method)
    );
  }

  for (const routeObj of filteredRoutes) {
    const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
    });

    if (routeObj.path && !routeObj.path.startsWith('/')) {
      throw new Error('Path should start with /: ' + routeObj.path);
    }

    registry.registerPath({ ...routeObj, security: [{ [bearerAuth.name]: [] }] });
  }
  return registry;
}

async function generateCodeSamples(document: OpenAPIObject) {
  const routes = getRoutes();
  const langs = ['shell', 'javascript_fetch', 'node', 'python'];
  const targetTitle: Record<string, string> = {
    shell: 'Shell',
    javascript_fetch: 'JavaScript',
    node: 'Node.js',
    python: 'Python',
  };
  for (const route of routes) {
    const generated = OpenAPISnippet.getEndpointSnippets(document, route.path, route.method, langs);
    const path = document.paths?.[route.path][route.method];
    if (path) {
      path['x-codeSamples'] = [];
      for (const [index, snippet] of generated.snippets.entries()) {
        const id = snippet.id as string;
        if (targetTitle[id]) {
          path['x-codeSamples'][index] = {
            lang: targetTitle[id],
            source: await snippet.content,
          };
        }
      }
    }
  }
}

export async function getOpenApiDocumentation(config: {
  origin?: string;
  snippet?: boolean;
  tags?: string[];
  paths?: string[];
  methods?: string[];
}): Promise<OpenAPIObject> {
  const { origin, snippet, tags, paths, methods } = config;
  if (!origin && snippet) {
    throw new Error('origin is required when snippets is true, generateCodeSamples need origin');
  }
  const registry = registerRoutes({ tags, paths, methods });
  const generator = new OpenApiGeneratorV3(registry.definitions);

  const document = generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Teable App',
      description: `Manage Data as easy as drink a cup of tea`,
    },
    servers: [{ url: origin + '/api' }],
  });
  if (snippet) {
    await generateCodeSamples(document);
  }
  return document;
}
