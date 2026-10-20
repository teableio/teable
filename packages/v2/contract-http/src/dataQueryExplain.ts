import { oc } from '@orpc/contract';
import { executeDataQueryRequestSchema, queryExplainResultSchema } from '@teable/v2-data-query';
import { z } from 'zod';

import { apiErrorResponseDtoSchema, apiOkResponseDtoSchema } from './shared/http';

/** Relative to the host-selected v2 API root (normally /api/v2). */
export const DATA_QUERY_EXPLAIN_PATH = '/queries/explain';

export const explainDataQueryOkResponseDtoSchema =
  apiOkResponseDtoSchema(queryExplainResultSchema).strict();

export const explainDataQueryResponseDtoSchema = z.union([
  explainDataQueryOkResponseDtoSchema,
  apiErrorResponseDtoSchema,
]);
export type ExplainDataQueryResponseDto = z.infer<typeof explainDataQueryResponseDtoSchema>;

/**
 * Same canonical request as execute: explain never accepts a weaker definition,
 * trusted identity or caller-supplied scope.
 */
export const dataQueryExplainContract = {
  explain: oc
    .route({
      method: 'POST',
      path: DATA_QUERY_EXPLAIN_PATH,
      summary: 'Explain an inline structured data query without reading records',
      description:
        'Runs admission, schema compatibility, parameter binding, authorization and routing, then returns caller-scoped SQL and an allow-listed plan summary. Never executes the business SELECT. Requires V2_DATA_QUERY_ENABLED.',
      tags: ['Data Query'],
    })
    .input(executeDataQueryRequestSchema)
    .output(explainDataQueryOkResponseDtoSchema),
} as const;
