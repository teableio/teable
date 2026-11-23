import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import {
  apiErrorResponseDtoSchema,
  dataQueryContract,
  dataQueryExplainContract,
  fieldDtoSchema,
  tableDtoSchema,
  tableRecordDtoSchema,
  v2Contract,
  viewDtoSchema,
} from '@teable/v2-contract-http';

export interface IV2OpenApiGenerateOptions {
  title?: string;
  version?: string;
  servers?: Array<{ url: string; description?: string }>;
  includeDataQuery?: boolean;
}

export const generateV2OpenApiDocument = async (options: IV2OpenApiGenerateOptions = {}) => {
  const openAPIGenerator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

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
    commonSchemas: {
      Table: { schema: tableDtoSchema, strategy: 'output' },
      Field: { schema: fieldDtoSchema, strategy: 'output' },
      View: { schema: viewDtoSchema, strategy: 'output' },
      Record: { schema: tableRecordDtoSchema, strategy: 'output' },
      ApiError: { schema: apiErrorResponseDtoSchema, strategy: 'output' },
    },
    customErrorResponseBodySchema: () => ({
      oneOf: [
        { $ref: '#/components/schemas/ApiError' },
        {
          type: 'object',
          properties: { ok: { const: false }, error: { type: 'string' } },
          required: ['ok', 'error'],
        },
      ],
    }),
  });
};
