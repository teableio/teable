import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import { getRoutes } from './utils';

function registerAllRoute() {
  const registry = new OpenAPIRegistry();
  const routeObjList: RouteConfig[] = getRoutes();
  for (const routeObj of routeObjList) {
    const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    registry.registerPath({ ...routeObj, security: [{ [bearerAuth.name]: [] }] });
  }
  return registry;
}

export function getOpenApiDocumentation(): OpenAPIObject {
  const registry = registerAllRoute();
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Teable App',
      description: `Manage Data as easy as drink a cup of tea`,
    },
    servers: [{ url: '/api/' }],
  });
}
