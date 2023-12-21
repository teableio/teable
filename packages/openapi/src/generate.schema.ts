import { Zod2OpenAPI, defaultBaseOpenApi } from './zod-to-openapi';

export const openApiGenerator = new Zod2OpenAPI(defaultBaseOpenApi);

openApiGenerator.registerComponent('securitySchemes', {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
});
