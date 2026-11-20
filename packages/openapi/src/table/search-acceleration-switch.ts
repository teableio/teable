import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SET_TABLE_SEARCH_ACCELERATION = '/base/{baseId}/table/{tableId}/search-acceleration';

export const tableSearchAccelerationSwitchRoSchema = z.object({
  enabled: z.boolean(),
  confirmLargeTable: z.boolean().optional(),
});
export type ITableSearchAccelerationSwitchRo = z.infer<
  typeof tableSearchAccelerationSwitchRoSchema
>;

export const tableSearchAccelerationSwitchVoSchema = z.object({
  intentState: z.enum(['disabled', 'preparing', 'enabled', 'disabling', 'failed']),
});
export type ITableSearchAccelerationSwitchVo = z.infer<
  typeof tableSearchAccelerationSwitchVoSchema
>;

export const SetTableSearchAccelerationRoute: RouteConfig = registerRoute({
  method: 'put',
  path: SET_TABLE_SEARCH_ACCELERATION,
  summary: 'Enable or disable table search acceleration',
  description:
    'Requires the table|update permission and the owner or creator role in the target space. Enabling tables with at least 50,000 records requires confirmation.',
  request: {
    params: z.object({ baseId: z.string(), tableId: z.string() }),
    body: {
      content: { 'application/json': { schema: tableSearchAccelerationSwitchRoSchema } },
    },
  },
  responses: {
    200: {
      description: 'Current search acceleration intent',
      content: { 'application/json': { schema: tableSearchAccelerationSwitchVoSchema } },
    },
  },
  tags: ['table'],
});

export const setTableSearchAcceleration = (
  baseId: string,
  tableId: string,
  body: ITableSearchAccelerationSwitchRo
) =>
  axios.put<ITableSearchAccelerationSwitchVo>(
    urlBuilder(SET_TABLE_SEARCH_ACCELERATION, { baseId, tableId }),
    body
  );
