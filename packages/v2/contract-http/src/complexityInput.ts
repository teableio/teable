import { z } from 'zod';

const MAX_SCHEMA_FIELDS = 2000;
const MAX_SCHEMA_EDGES = 10000;
const MAX_CONDITION_FIELDS = 100;
const MAX_CHANGED_FIELDS = 1000;
const MAX_ASSUMPTION_KEYS = 5000;
const MAX_FORMULA_KEYS = 64;
const MAX_FORMULA_BYTES = 16_384;

const boundedRecord = <T extends z.ZodTypeAny>(
  value: T,
  maxKeys: number,
  label: string
): z.ZodType<Record<string, z.infer<T>>> =>
  z.record(z.string(), value).refine((record) => Object.keys(record).length <= maxKeys, {
    message: `${label} supports at most ${maxKeys} keys`,
  });

/**
 * Field metadata for the pure schema profile. Formula analysis is supplied as
 * an opaque object: this contract validates the schema envelope, not the
 * formula parser's output shape.
 */
const schemaComplexityFormulaSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length <= MAX_FORMULA_KEYS, {
    message: `formula supports at most ${MAX_FORMULA_KEYS} keys`,
  })
  .refine((value) => JSON.stringify(value).length <= MAX_FORMULA_BYTES, {
    message: `formula must be at most ${MAX_FORMULA_BYTES} bytes`,
  });

const schemaComplexityFieldSchema = z.object({
  id: z.string().min(1),
  tableId: z.string().min(1),
  type: z.string().min(1),
  isComputed: z.boolean(),
  conditional: z.boolean().optional(),
  formula: schemaComplexityFormulaSchema.optional(),
});

const schemaComplexityEdgeSchema = z.object({
  fromFieldId: z.string().min(1),
  toFieldId: z.string().min(1),
  fromTableId: z.string().min(1),
  toTableId: z.string().min(1),
  kind: z.enum(['same_record', 'cross_record']),
  linkFieldId: z.string().min(1).optional(),
  conditional: z.boolean().optional(),
  conditionFieldIds: z.array(z.string().min(1)).max(MAX_CONDITION_FIELDS).optional(),
});

export const complexityOperationDescriptorSchema = z.object({
  kind: z.enum(['update', 'create', 'delete', 'paste', 'field-change']),
  tableId: z.string().min(1),
  changedFieldIds: z.array(z.string().min(1)).max(MAX_CHANGED_FIELDS),
  beforeImage: z.enum(['available', 'unavailable', 'unknown']).optional(),
  fieldChange: z.enum(['create', 'update', 'delete', 'convert']).optional(),
  pasteMode: z.enum(['insert', 'update', 'mixed']).optional(),
  dataPresence: z.enum(['unknown', 'empty']).optional(),
});

const linkFanoutAssumptionSchema = z.object({
  mean: z.number().nonnegative().optional(),
  p50: z.number().nonnegative().optional(),
  p95: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
});

export const complexityAssumptionsSchema = z.object({
  rowCounts: boundedRecord(z.number().nonnegative(), MAX_ASSUMPTION_KEYS, 'rowCounts').optional(),
  seedRecordCount: z.number().nonnegative().optional(),
  linkFanout: boundedRecord(
    linkFanoutAssumptionSchema,
    MAX_ASSUMPTION_KEYS,
    'linkFanout'
  ).optional(),
  conditionalTargetHitFractions: boundedRecord(
    z.object({
      fraction: z.number().min(0).max(1),
      sourceDirtyCount: z.number().int().nonnegative(),
      includesBeforeImage: z.boolean(),
    }),
    MAX_ASSUMPTION_KEYS,
    'conditionalTargetHitFractions'
  ).optional(),
  avgInputRows: boundedRecord(
    z.number().nonnegative(),
    MAX_ASSUMPTION_KEYS,
    'avgInputRows'
  ).optional(),
  changeRate: z.number().min(0).max(1).optional(),
  capturedAt: z.string().min(1).max(80).optional(),
});

const schemaComplexityInputSchema = z.object({
  fields: z.array(schemaComplexityFieldSchema).max(MAX_SCHEMA_FIELDS),
  edges: z.array(schemaComplexityEdgeSchema).max(MAX_SCHEMA_EDGES),
});

/**
 * Caller either names an existing table (`tableId`, resolved by the host) or
 * supplies a literal schema. Supplying neither is ambiguous; supplying both
 * leaves two possible sources of truth.
 */
export const complexityAssessInputSchema = z
  .object({
    tableId: z.string().min(1).optional(),
    schema: schemaComplexityInputSchema.optional(),
    operation: complexityOperationDescriptorSchema.optional(),
    assumptions: complexityAssumptionsSchema.optional(),
    completeness: z.enum(['complete', 'partial', 'truncated']).optional(),
    focusTableId: z.string().min(1).optional(),
    maxTraversalDepth: z.number().int().nonnegative().optional(),
    /**
     * Only meaningful with `tableId`. Schema-mode callers must not trigger
     * catalog reads; the service validates/ignores this flag for them.
     */
    includeCatalogStats: z.boolean().optional().default(false),
  })
  .refine((input) => (input.tableId !== undefined) !== (input.schema !== undefined), {
    message: 'Provide exactly one of tableId or schema',
  });
