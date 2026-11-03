import { z } from 'zod';

import { complexityAssessmentSchema } from './complexityAssessment';

type OperationPreviewHttpError = {
  readonly code: string;
  readonly message: string;
  readonly tags: ReadonlyArray<string>;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly localization?: {
    readonly i18nKey: string;
    readonly context?: Readonly<Record<string, unknown>>;
  };
};

type OperationPreviewApiOk<T> = { readonly ok: true; readonly data: T };
type OperationPreviewApiResponse<T> =
  | OperationPreviewApiOk<T>
  | { readonly ok: false; readonly error: OperationPreviewHttpError };

export const OPERATION_PREVIEW_PATH = '/operations/preview';
export const OPERATION_PREVIEW_CAPABILITIES_PATH = '/operations/preview/capabilities';

export const previewOperationValues = [
  'field.delete',
  'field.convert',
  'table.delete',
  'table.duplicate',
  'records.paste',
  'records.bulkUpdate',
  'records.bulkDelete',
  'base.duplicate',
] as const;

export const previewOperationSchema = z.enum(previewOperationValues);

/**
 * Requests deliberately accept any non-empty operation code so the planner
 * registry can return its stable unsupported-operation DomainError. Registered
 * planners remain the sole validators of the operation-specific `input`.
 */
const previewOperationRequestCodeSchema = z.string().min(1);

export const previewMeasureSchema = z.discriminatedUnion('basis', [
  z.object({
    basis: z.literal('exact'),
    value: z.number(),
    unit: z.string().min(1),
  }),
  z.object({
    basis: z.literal('estimate'),
    value: z.number(),
    unit: z.string().min(1),
    source: z.string().min(1),
  }),
  z.object({
    basis: z.literal('range'),
    lower: z.number().nullable(),
    expected: z.number().nullable(),
    upper: z.number().nullable(),
    unit: z.string().min(1),
    source: z.string().min(1),
  }),
  z.object({
    basis: z.literal('unknown'),
    unit: z.string().min(1),
    reason: z.string().min(1),
  }),
]);

export const previewResourceKindSchema = z.enum([
  'base',
  'space',
  'table',
  'field',
  'view',
  'record',
  'attachment',
  'workflow',
  'share',
  'app',
  'runtime',
  'host',
]);

export const previewResourceReferenceSchema = z.discriminatedUnion('visibility', [
  z.object({
    visibility: z.literal('authorized'),
    kind: previewResourceKindSchema,
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  z.object({
    visibility: z.literal('redacted'),
    kind: previewResourceKindSchema,
    quantity: previewMeasureSchema,
    reason: z.string().min(1),
  }),
]);

export const previewEffectKindSchema = z.enum([
  'dependency.change',
  'field.conversion',
  'record.insert',
  'record.update',
  'record.delete',
  'record.rewrite',
  'resource.copy',
  'resource.trash',
  'resource.permanent-delete',
  'host.effect',
]);

export const previewEffectSchema = z.object({
  code: z.string().min(1),
  kind: previewEffectKindSchema,
  summary: z.string().optional(),
  resource: previewResourceReferenceSchema.optional(),
  relatedResources: z.array(previewResourceReferenceSchema).readonly().optional(),
  measures: z.record(z.string(), previewMeasureSchema),
});

export const previewIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().optional(),
  resource: previewResourceReferenceSchema.optional(),
});

export const operationPreviewOptionsSchema = z.object({
  detail: z.enum(['summary', 'full']).optional(),
  includeComplexity: z.boolean().optional(),
  maxItems: z.number().int().min(1).max(1_000).optional(),
});

export const operationPreviewInputSchema = z
  .object({
    operation: previewOperationRequestCodeSchema,
    input: z.unknown(),
    options: operationPreviewOptionsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!Object.prototype.hasOwnProperty.call(value, 'input')) {
      context.addIssue({
        code: 'custom',
        path: ['input'],
        message: 'Operation preview input is required',
      });
    }
  });

export const operationPreviewSchema = z.object({
  operation: previewOperationSchema,
  outcome: z.enum(['ready', 'blocked', 'incomplete']),
  effects: z.array(previewEffectSchema).readonly(),
  blockers: z.array(previewIssueSchema).readonly(),
  warnings: z.array(previewIssueSchema).readonly(),
  coverage: z.object({
    known: z.array(z.string()).readonly(),
    unknown: z.array(z.string()).readonly(),
  }),
  complexity: complexityAssessmentSchema.nullable(),
  authorization: z.enum(['checked', 'not-applicable']),
  observedAt: z.iso.datetime({ offset: true }),
  consistency: z.enum(['best-effort', 'snapshot']),
  requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  implementation: z.object({
    plannerVersion: z.string().min(1),
    executionPath: z.string().min(1),
  }),
});

export const operationPreviewOkResponseSchema = z.object({
  ok: z.literal(true),
  data: operationPreviewSchema,
});

export const previewCapabilitySchema = z.object({
  operation: previewOperationSchema,
  canonicalWriteRoute: z.string().min(1),
  supportLevel: z.enum(['full', 'partial', 'validation-only']),
  requiredPermissionScope: z.string().min(1),
  detailLevels: z
    .array(z.enum(['summary', 'full']))
    .min(1)
    .readonly(),
  limitations: z.array(z.string()).readonly(),
});

export const operationPreviewCapabilitiesInputSchema = z.object({});
export const operationPreviewCapabilitiesSchema = z.array(previewCapabilitySchema).readonly();
export const operationPreviewCapabilitiesOkResponseSchema = z.object({
  ok: z.literal(true),
  data: operationPreviewCapabilitiesSchema,
});

export type IOperationPreviewRequestDto = z.infer<typeof operationPreviewInputSchema>;
export type IOperationPreviewDto = z.infer<typeof operationPreviewSchema>;
export type IOperationPreviewOkResponseDto = OperationPreviewApiOk<IOperationPreviewDto>;
export type IOperationPreviewResponseDto = OperationPreviewApiResponse<IOperationPreviewDto>;
export type IPreviewCapabilityDto = z.infer<typeof previewCapabilitySchema>;
export type IOperationPreviewCapabilitiesDto = z.infer<typeof operationPreviewCapabilitiesSchema>;
export type IOperationPreviewCapabilitiesOkResponseDto =
  OperationPreviewApiOk<IOperationPreviewCapabilitiesDto>;
export type IOperationPreviewCapabilitiesResponseDto =
  OperationPreviewApiResponse<IOperationPreviewCapabilitiesDto>;
