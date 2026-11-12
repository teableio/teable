import { updateFieldInputSchema } from '@teable/v2-core';
import { z } from 'zod';

import { dataQueryCapabilities } from './DataQueryCapabilities';
import { dataQueryDefinitionInputSchema, guardDataQueryPlainInput } from './DataQueryDefinition';
import { dataQueryIdSchema } from './DataQueryManifest';
import { dataQueryFieldUsageValues } from './types';
import type { DataQueryFieldUsage, DataQueryOutput } from './types';

export { dataQueryCapabilities } from './DataQueryCapabilities';

/** Public inline input. Identity and permissions belong only to the execution context. */
const executeDataQueryRequestObjectSchema = z
  .object({
    definition: dataQueryDefinitionInputSchema,
    parameters: z.record(z.string(), z.json()).optional(),
    queryId: dataQueryIdSchema.optional(),
  })
  .strict();
export const executeDataQueryRequestSchema = guardDataQueryPlainInput(
  executeDataQueryRequestObjectSchema
).meta({ 'x-teable-data-query-capabilities': dataQueryCapabilities });

/** Server admission defers definition diagnostics to canonical construction. */
export const executeDataQueryEnvelopeSchema = guardDataQueryPlainInput(
  executeDataQueryRequestObjectSchema.extend({
    definition: z.unknown().refine((value) => value !== undefined),
  }),
  { deferDefinition: true }
);

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

/** A command descriptor, never caller-supplied schema. Hosts must authorize its preparation. */
export const dataQueryCandidateSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('delete'),
      tableId: z.string(),
      fieldIds: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal('convert'),
      tableId: z.string(),
      fieldId: z.string(),
      inputFormat: z.enum(['field-openapi', 'field-v2']).optional(),
      field: z.record(z.string(), z.unknown()),
    })
    .strict()
    .superRefine((candidate, context) => {
      const valid =
        candidate.inputFormat === 'field-v2'
          ? updateFieldInputSchema.safeParse(candidate).success
          : typeof candidate.field.type === 'string';
      if (!valid)
        context.addIssue({ code: 'custom', message: 'Invalid field conversion candidate' });
    }),
]);
export type DataQueryCandidate = z.infer<typeof dataQueryCandidateSchema>;

const validateDataQueryRequestObjectSchema = z
  .object({
    definition: dataQueryDefinitionInputSchema,
    includeUsage: z.boolean().optional(),
    includeSchemaSignature: z.boolean().optional(),
    candidate: dataQueryCandidateSchema.optional(),
    candidateProof: z.string().min(1).optional(),
  })
  .strict();
export const validateDataQueryRequestSchema = guardDataQueryPlainInput(
  validateDataQueryRequestObjectSchema
).meta({ 'x-teable-data-query-capabilities': dataQueryCapabilities });

export const validateDataQueryEnvelopeSchema = guardDataQueryPlainInput(
  validateDataQueryRequestObjectSchema.extend({
    definition: z.unknown().refine((value) => value !== undefined),
  }),
  { deferDefinition: true }
);
export type ValidateDataQueryRequest = z.infer<typeof validateDataQueryRequestSchema>;

export type DataQueryValidationUsage = ReadonlyArray<{
  readonly source: string;
  readonly tableId: string;
  readonly fieldId: string;
  readonly usages: ReadonlyArray<DataQueryFieldUsage>;
}>;

export const dataQueryValidationUsageSchema: z.ZodType<DataQueryValidationUsage> = z.array(
  z
    .object({
      source: z.string(),
      tableId: z.string(),
      fieldId: z.string(),
      usages: z.array(z.enum(dataQueryFieldUsageValues)),
    })
    .strict()
);

export type DataQueryValidationResult = {
  readonly outputs: ReadonlyArray<DataQueryOutput>;
  readonly usage?: DataQueryValidationUsage;
  readonly schemaSignature?: string;
};

export const queryValidationResultSchema: z.ZodType<DataQueryValidationResult> = z
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
    usage: dataQueryValidationUsageSchema.optional(),
    schemaSignature: z.string().optional(),
  })
  .strict();
