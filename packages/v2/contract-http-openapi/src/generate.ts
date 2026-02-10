import { OpenAPIGenerator } from '@orpc/openapi';
import { v2Contract } from '@teable/v2-contract-http';

export interface IV2OpenApiGenerateOptions {
  title?: string;
  version?: string;
  servers?: Array<{ url: string; description?: string }>;
}

export const generateV2OpenApiDocument = async (options: IV2OpenApiGenerateOptions = {}) => {
  const openAPIGenerator = new OpenAPIGenerator();

  return openAPIGenerator.generate(v2Contract, {
    info: {
      title: options.title ?? 'Teable v2 API',
      version: options.version ?? '0.0.0',
    },
    servers: options.servers,
    customErrorResponseBodySchema: () => ({
      type: 'object',
      properties: {
        ok: { const: false },
        error: { type: 'string' },
      },
      required: ['ok', 'error'],
    }),
  });
};
