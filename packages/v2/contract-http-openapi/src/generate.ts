import { OpenAPIGenerator } from '@orpc/openapi';
import { dataQueryContract, dataQueryExplainContract, v2Contract } from '@teable/v2-contract-http';

export interface IV2OpenApiGenerateOptions {
  title?: string;
  version?: string;
  servers?: Array<{ url: string; description?: string }>;
  includeDataQuery?: boolean;
}

export const generateV2OpenApiDocument = async (options: IV2OpenApiGenerateOptions = {}) => {
  const openAPIGenerator = new OpenAPIGenerator();

  const contract = options.includeDataQuery
    ? {
        ...v2Contract,
        queries: { ...dataQueryContract, ...dataQueryExplainContract },
      }
    : v2Contract;
  return openAPIGenerator.generate(contract, {
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
