import { z } from 'zod';

import { dataQueryDefinitionInputSchema } from './DataQueryDefinition';
import { dataQueryIdSchema } from './DataQueryManifest';

/** Public inline input. Identity and permissions belong only to the execution context. */
export const executeDataQueryRequestSchema = z
  .object({
    definition: dataQueryDefinitionInputSchema,
    parameters: z.record(z.string(), z.json()).optional(),
    queryId: dataQueryIdSchema.optional(),
  })
  .strict();

export type ExecuteDataQueryRequest = z.infer<typeof executeDataQueryRequestSchema>;

export const dataQueryPageSchema = z
  .object({
    limit: z.number().int().min(1).max(1000),
    offset: z.number().int().min(0).max(2147483647),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const queryExecutionResultSchema = z
  .object({
    rows: z.array(z.record(z.string(), z.json())),
    /** Omitted unless the definition opts in with page.includeTotal. */
    page: dataQueryPageSchema.optional(),
  })
  .strict();

/** Structural discovery; live field semantics and authorization are enforced by execution. */
export const queryExecutionJsonSchema = () =>
  z.toJSONSchema(executeDataQueryRequestSchema, { target: 'draft-2020-12', io: 'input' });

export const validateDataQueryRequestSchema = z
  .object({ definition: dataQueryDefinitionInputSchema })
  .strict();
export type ValidateDataQueryRequest = z.infer<typeof validateDataQueryRequestSchema>;
export const queryValidationResultSchema = z
  .object({
    outputs: z.array(
      z
        .object({
          alias: z.string(),
          wireType: z.enum(['string', 'numberOrString', 'boolean', 'unknown']),
          cellValueType: z.string(),
          isMultipleCellValue: z.boolean(),
          nullable: z.boolean(),
        })
        .strict()
    ),
  })
  .strict();
export type DataQueryValidationResult = z.infer<typeof queryValidationResultSchema>;
