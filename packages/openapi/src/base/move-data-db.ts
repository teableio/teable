import { z } from '../zod';

export const moveBaseDataDbEndpointSchema = z.object({
  mode: z.enum(['default', 'byodb']),
  cacheKey: z.string(),
  connectionId: z.string().optional(),
  displayHost: z.string().nullable().optional(),
  displayDatabase: z.string().nullable().optional(),
  internalSchema: z.string().optional(),
});

export type IMoveBaseDataDbEndpoint = z.infer<typeof moveBaseDataDbEndpointSchema>;

export const moveBaseDataDbCheckSchema = z.object({
  sameDataDb: z.boolean(),
  requiresPhysicalMove: z.boolean(),
  source: moveBaseDataDbEndpointSchema,
  target: moveBaseDataDbEndpointSchema,
  estimatedBytes: z.number().optional(),
  estimatedRows: z.number().optional(),
});

export type IMoveBaseDataDbCheck = z.infer<typeof moveBaseDataDbCheckSchema>;

export const baseDataDbMoveJobStateSchema = z.enum([
  'pending',
  'waiting_worker',
  'copying_base_schema',
  'copying_shared_rows',
  'validating',
  'switching',
  'succeeded',
  'failed',
  'cancelled',
]);

export type IBaseDataDbMoveJobState = z.infer<typeof baseDataDbMoveJobStateSchema>;

export const moveBaseVoSchema = z.object({
  jobId: z.string().optional(),
  async: z.boolean().optional(),
});

export type IMoveBaseVo = z.infer<typeof moveBaseVoSchema>;

export const baseDataDbMoveJobStatusVoSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  sourceSpaceId: z.string(),
  targetSpaceId: z.string(),
  state: baseDataDbMoveJobStateSchema,
  phase: z.string().optional(),
  progressPercent: z.number().optional(),
  copyStats: z.unknown().optional(),
  validationStats: z.unknown().optional(),
  lastError: z.string().nullable().optional(),
  cancelable: z.boolean(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdTime: z.string(),
});

export type IBaseDataDbMoveJobStatusVo = z.infer<typeof baseDataDbMoveJobStatusVoSchema>;
