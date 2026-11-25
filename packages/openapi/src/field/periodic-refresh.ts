import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldPeriodicRefreshVoSchema } from '@teable/core';
import type { AxiosResponse } from 'axios';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';

export const TRIGGER_FIELD_PERIODIC_REFRESH = '/table/{tableId}/field/{fieldId}/periodic-refresh';

export const periodicRefreshTriggerStatusSchema = z.enum([
  'refreshed',
  'queued',
  'deduped',
  'skipped_unchanged',
  'skipped_db_unhealthy',
]);

export type IPeriodicRefreshTriggerStatus = z.infer<typeof periodicRefreshTriggerStatusSchema>;

export const triggerFieldPeriodicRefreshVoSchema = z.object({
  status: periodicRefreshTriggerStatusSchema,
  mode: z.enum(['sync', 'async', 'none']),
  taskId: z.string().nullable().optional(),
  refreshedAt: z.string().nullable().optional(),
  periodicRefresh: fieldPeriodicRefreshVoSchema.optional(),
});

export type ITriggerFieldPeriodicRefreshVo = z.infer<typeof triggerFieldPeriodicRefreshVoSchema>;

export const updateFieldPeriodicRefreshRoSchema = z.object({
  enabled: z.boolean(),
});

export type IUpdateFieldPeriodicRefreshRo = z.infer<typeof updateFieldPeriodicRefreshRoSchema>;

export const updateFieldPeriodicRefreshVoSchema = z.object({
  fieldId: z.string(),
  periodicRefresh: fieldPeriodicRefreshVoSchema,
});

export type IUpdateFieldPeriodicRefreshVo = z.infer<typeof updateFieldPeriodicRefreshVoSchema>;

export const TriggerFieldPeriodicRefreshRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TRIGGER_FIELD_PERIODIC_REFRESH,
  summary: 'Trigger periodic field refresh now',
  description:
    'Recompute a relative-date lookup/rollup or time-sensitive formula field and its downstream dependencies.',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Periodic field refresh trigger outcome',
      content: {
        'application/json': {
          schema: triggerFieldPeriodicRefreshVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const UpdateFieldPeriodicRefreshRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: TRIGGER_FIELD_PERIODIC_REFRESH,
  summary: 'Update periodic refresh setting for a field',
  description:
    'Enable or disable automated periodic refresh for a relative-date lookup/rollup or time-sensitive formula field.',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateFieldPeriodicRefreshRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated periodic refresh setting',
      content: {
        'application/json': {
          schema: updateFieldPeriodicRefreshVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export async function triggerFieldPeriodicRefresh(
  tableId: string,
  fieldId: string
): Promise<AxiosResponse<ITriggerFieldPeriodicRefreshVo>> {
  return axios.post<ITriggerFieldPeriodicRefreshVo>(
    urlBuilder(TRIGGER_FIELD_PERIODIC_REFRESH, { tableId, fieldId })
  );
}

export async function updateFieldPeriodicRefresh(
  tableId: string,
  fieldId: string,
  ro: IUpdateFieldPeriodicRefreshRo
): Promise<AxiosResponse<IUpdateFieldPeriodicRefreshVo>> {
  return axios.patch<IUpdateFieldPeriodicRefreshVo>(
    urlBuilder(TRIGGER_FIELD_PERIODIC_REFRESH, { tableId, fieldId }),
    ro
  );
}
