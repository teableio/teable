import { oc } from '@orpc/contract';
import {
  executeDataQueryRequestSchema,
  queryExecutionResultSchema,
  validateDataQueryRequestSchema,
  queryValidationResultSchema,
} from '@teable/v2-data-query';
import type { OpenAPIV3_1 } from 'openapi-types';
import { z } from 'zod';

import { apiErrorResponseDtoSchema, apiOkResponseDtoSchema } from './shared/http';

/** Relative to the host-selected v2 API root (normally /api/v2). */
export const DATA_QUERY_EXECUTE_PATH = '/queries/execute';
export const DATA_QUERY_VALIDATE_PATH = '/queries/validate';

export const executeDataQueryOkResponseDtoSchema = apiOkResponseDtoSchema(
  queryExecutionResultSchema
).strict();

export const executeDataQueryResponseDtoSchema = z.union([
  executeDataQueryOkResponseDtoSchema,
  apiErrorResponseDtoSchema
    .extend({
      error: apiErrorResponseDtoSchema.shape.error
        .extend({
          localization: apiErrorResponseDtoSchema.shape.error.shape.localization
            .unwrap()
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type ExecuteDataQueryResponseDto = z.infer<typeof executeDataQueryResponseDtoSchema>;

export const validateDataQueryOkResponseDtoSchema = apiOkResponseDtoSchema(
  queryValidationResultSchema
).strict();
export const validateDataQueryResponseDtoSchema = z.union([
  validateDataQueryOkResponseDtoSchema,
  executeDataQueryResponseDtoSchema.options[1],
]);
export type ValidateDataQueryResponseDto = z.infer<typeof validateDataQueryResponseDtoSchema>;

/** Opt-in only: deliberately not included in v2Contract. */
export const dataQueryContract = {
  validate: oc
    .route({
      method: 'POST',
      path: DATA_QUERY_VALIDATE_PATH,
      successStatus: 200,
      summary:
        'Validate a structured query without reading records (requires V2_DATA_QUERY_ENABLED)',
      tags: ['data-query'],
      spec: (operation) => ({
        ...operation,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                ...z.toJSONSchema(validateDataQueryRequestSchema, {
                  target: 'draft-2020-12',
                  io: 'input',
                }),
                $id: 'urn:teable:data-query:validate:request',
              } as OpenAPIV3_1.SchemaObject,
            },
          },
        },
        responses: {
          ...operation.responses,
          200: {
            description: 'Validated output contract',
            content: {
              'application/json': {
                schema: {
                  ...z.toJSONSchema(validateDataQueryOkResponseDtoSchema, {
                    target: 'draft-2020-12',
                    io: 'output',
                  }),
                  $id: 'urn:teable:data-query:validate:success',
                } as OpenAPIV3_1.SchemaObject,
              },
            },
          },
          ...Object.fromEntries(
            [400, 401, 403, 404, 500].map((status) => [
              String(status),
              {
                description: String(status),
                content: {
                  'application/json': {
                    schema: z.toJSONSchema(executeDataQueryResponseDtoSchema.options[1], {
                      target: 'openapi-3.0',
                    }) as OpenAPIV3_1.SchemaObject,
                  },
                },
              },
            ])
          ),
        },
      }),
    })
    .input(validateDataQueryRequestSchema)
    .output(validateDataQueryOkResponseDtoSchema),
  execute: oc
    .route({
      method: 'POST',
      path: DATA_QUERY_EXECUTE_PATH,
      successStatus: 200,
      summary: 'Execute an inline structured data query (requires V2_DATA_QUERY_ENABLED)',
      tags: ['data-query'],
      spec: (operation) => {
        // ORPC does not expose Zod schemas in the generated document by default.
        // Convert explicitly so this opt-in route advertises its complete JSON contract.
        const requestSchema = {
          ...z.toJSONSchema(executeDataQueryRequestSchema, {
            target: 'draft-2020-12',
            io: 'input',
          }),
          // A schema resource keeps recursive $defs relative to this schema, not the OpenAPI root.
          $id: 'urn:teable:data-query:request',
        } as OpenAPIV3_1.SchemaObject;
        const successSchema = {
          ...z.toJSONSchema(executeDataQueryOkResponseDtoSchema, {
            target: 'draft-2020-12',
            io: 'output',
          }),
          $id: 'urn:teable:data-query:success',
        } as OpenAPIV3_1.SchemaObject;
        const errorSchema = z.toJSONSchema(apiErrorResponseDtoSchema, {
          target: 'openapi-3.0',
        }) as OpenAPIV3_1.SchemaObject;
        return {
          ...operation,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: requestSchema } },
          },
          responses: {
            ...operation.responses,
            200: {
              description: 'Success',
              content: { 'application/json': { schema: successSchema } },
            },
            ...Object.fromEntries(
              [400, 401, 403, 404, 500, 504].map((status) => [
                String(status),
                {
                  description: String(status),
                  content: { 'application/json': { schema: errorSchema } },
                },
              ])
            ),
          },
        };
      },
    })
    .input(executeDataQueryRequestSchema)
    .output(executeDataQueryOkResponseDtoSchema),
} as const;
