import { z } from '../../../zod';

export const periodicRefreshCadenceSchema = z.enum(['day', 'week', 'month']);
export type PeriodicRefreshCadence = z.infer<typeof periodicRefreshCadenceSchema>;

export const periodicRefreshStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'completed',
  'skipped_unchanged',
  'paused_plan_downgrade',
  'skipped_db_unhealthy',
  'failed',
]);
export type PeriodicRefreshStatus = z.infer<typeof periodicRefreshStatusSchema>;

export const fieldPeriodicRefreshVoSchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean(),
  cadence: periodicRefreshCadenceSchema,
  timeZone: z.string(),
  containsNowPrecision: z.boolean().optional(),
  lastRefreshedAt: z.string().nullable().optional(),
  lastRefreshedLocalDate: z.string().nullable().optional(),
  lastStatus: periodicRefreshStatusSchema.optional(),
});

export type IFieldPeriodicRefreshVo = z.infer<typeof fieldPeriodicRefreshVoSchema>;
