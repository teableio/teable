import type {
  DataEstimate,
  EstimatedRange,
  PathDataEstimate,
  SchemaComplexityProfile,
} from '@teable/v2-complexity';
import { z } from 'zod';

import { complexityAssessmentSchema, estimatedRangeSchema } from './complexityAssessment';
import { complexityAssumptionsSchema } from './complexityInput';
import type { complexityAssessInputSchema } from './complexityInput';
import {
  apiOkResponseDtoSchema,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from './shared/http';

export type {
  DataEstimate as IComplexityDataEstimateDto,
  EstimatedRange as IComplexityRangeDto,
  PathDataEstimate as IComplexityPathEstimateDto,
};
export { complexityAssessmentSchema, estimatedRangeSchema } from './complexityAssessment';

export * from './complexityPaths';

export * from './complexityInput';

/**
 * Mirrors the schema-only profile envelope plus the optional Phase 2 data
 * estimate. Nested values stay passthrough until the producing package owns a
 * versioned DTO.
 *
 * Deliberately has no `runtimeCost`: until Phase 3 records real runtime
 * evidence, an always-null block would look like supported data.
 */
export const complexityProfileSchema = z
  .object({
    version: z.literal(1),
    basis: z.literal('schema-only'),
    scope: z.record(z.string(), z.unknown()),
    structural: z.record(z.string(), z.unknown()),
    formulas: z.array(z.record(z.string(), z.unknown())).readonly(),
    operation: z.record(z.string(), z.unknown()).nullable(),
    dataEstimate: z.record(z.string(), z.unknown()).optional(),
    evidence: z.record(z.string(), z.unknown()),
    warnings: z.array(z.string()).readonly(),
  })
  .passthrough();

export const complexityAssessResultSchema = z.object({
  profile: complexityProfileSchema,
  assessment: complexityAssessmentSchema,
});

export const complexityAssessOkResponseSchema = apiOkResponseDtoSchema(
  complexityAssessResultSchema
);

const complexityMatrixOperationSchema = z.enum([
  'update',
  'field-delete',
  'field-convert',
  'create-record',
  'delete-record',
]);

export const complexityAssessMatrixInputSchema = z.object({
  tableId: z.string().min(1),
  fieldIds: z.array(z.string().min(1)).max(1000).optional(),
  operations: z.array(complexityMatrixOperationSchema).max(5).optional(),
  maxFields: z.number().int().min(1).max(1000).optional(),
  assumptions: complexityAssumptionsSchema.optional(),
  includeCatalogStats: z.boolean().optional().default(true),
});

const complexityMatrixBasisSchema = z.literal('schema-potential-only');
const complexityMatrixCellBasisSchema = z.literal('schema-potential-only');

const complexityMatrixCellSchema = z.object({
  operation: complexityMatrixOperationSchema,
  /** How the structural operation shape was obtained for this cell. */
  basis: complexityMatrixCellBasisSchema,
  level: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
  score: z.number().min(0).max(100).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  workload: z.object({
    status: z.enum(['estimated', 'bounded', 'unknown']),
    rows: estimatedRangeSchema,
    typicalLevel: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
    worstCaseLevel: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
    level: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
    basis: z.literal('max-scan-dirty'),
    warnings: z.array(z.string()),
  }),
  structural: z.number().nonnegative(),
  dataWork: z.number().nonnegative().nullable(),
  risk: z.number().nonnegative(),
  reasonCodes: z.array(z.string()),
  warnings: z.array(z.string()),
});

const complexityMatrixRowSchema = z.object({
  scope: z.enum(['field', 'table']),
  /** Null for table-scope rows (create/delete record). */
  fieldId: z.string().min(1).nullable(),
  fieldType: z.string().min(1).nullable(),
  tableId: z.string().min(1),
  level: z.enum(['unknown', 'trivial', 'low', 'medium', 'high', 'critical']),
  /** Expected rows, max across the row's cells; null when unknown. */
  typicalRows: z.number().nonnegative().nullable(),
  /** Upper/lower bound as worst case; never a percentile presented as max. */
  worstRows: z.number().nonnegative().nullable(),
  mainReason: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  basis: complexityMatrixBasisSchema,
  unknownCellCount: z.number().int().nonnegative(),
  cells: z.array(complexityMatrixCellSchema),
});

export const complexityAssessMatrixResultSchema = z.object({
  tableId: z.string().min(1),
  completeness: z.enum(['complete', 'partial', 'truncated']),
  fieldCount: z.number().int().nonnegative(),
  /** Matrix is schema-potential-only in this slice. */
  basis: complexityMatrixBasisSchema,
  /** All rows; known cells remain ranked even when a row also has unknown cells. */
  rows: z.array(complexityMatrixRowSchema),
  /** Marker subset: rows containing at least one unknown cell. */
  unknownRows: z.array(complexityMatrixRowSchema),
  warnings: z.array(z.string()),
});

export const complexityAssessMatrixOkResponseSchema = apiOkResponseDtoSchema(
  complexityAssessMatrixResultSchema
);

export type IComplexityAssessMatrixInputDto = z.infer<typeof complexityAssessMatrixInputSchema>;
export type IComplexityMatrixCellDto = z.infer<typeof complexityMatrixCellSchema>;
export type IComplexityMatrixRowDto = z.infer<typeof complexityMatrixRowSchema>;
export type IComplexityAssessMatrixResultDto = z.infer<typeof complexityAssessMatrixResultSchema>;
export type IComplexityAssessMatrixOkResponseDto =
  IApiOkResponseDto<IComplexityAssessMatrixResultDto>;
export type IComplexityAssessMatrixResponseDto = IApiResponseDto<IComplexityAssessMatrixResultDto>;

export type IComplexityAssessInputDto = z.infer<typeof complexityAssessInputSchema>;
/** Wire input as the caller writes it (defaults not applied). */
export type IComplexityAssessRequestDto = z.input<typeof complexityAssessInputSchema>;
/**
 * The runtime envelope stays passthrough, but the export is the producer's
 * precise profile so hosts and admin UIs do not hand-copy fields.
 */
export type IComplexityProfileDto = SchemaComplexityProfile;
export type IComplexityAssessmentDto = z.infer<typeof complexityAssessmentSchema>;
export type IComplexityAssessResultDto = {
  readonly profile: SchemaComplexityProfile;
  readonly assessment: IComplexityAssessmentDto;
};
export type IComplexityAssessOkResponseDto = IApiOkResponseDto<IComplexityAssessResultDto>;
export type IComplexityAssessResponseDto = IApiResponseDto<IComplexityAssessResultDto>;
export type IComplexityAssessMatrixRequestDto = z.input<typeof complexityAssessMatrixInputSchema>;
