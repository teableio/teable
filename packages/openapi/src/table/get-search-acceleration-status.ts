import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_TABLE_SEARCH_ACCELERATION_STATUS =
  '/base/{baseId}/table/{tableId}/search-acceleration-status';
export const GET_SHARE_SEARCH_ACCELERATION_STATUS = '/share/{shareId}/search-acceleration-status';

export const tableSearchAccelerationStatusSchema = z.object({
  tableId: z.string(),
  intentState: z.enum(['disabled', 'preparing', 'enabled', 'disabling', 'failed']),
  /** Physical snapshot availability, independent of product intent and query routing. */
  serving: z.boolean(),
  /** Omitted when the caller's field visibility is restricted. */
  coveredFieldIds: z.array(z.string()).optional(),
  uncoveredFieldIds: z.array(z.string()).optional(),
});
export type ITableSearchAccelerationStatusVo = z.infer<typeof tableSearchAccelerationStatusSchema>;

export const shareSearchAccelerationStatusSchema = z.object({
  /** A physical snapshot serves at least one field this share may read, using the same
   * visibility policy that scopes share search. It does not imply every visible field is
   * covered, nor that ordinary search is unavailable when false. */
  accelerationServing: z.boolean(),
});
export type IShareSearchAccelerationStatusVo = z.infer<typeof shareSearchAccelerationStatusSchema>;

export const GetTableSearchAccelerationStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TABLE_SEARCH_ACCELERATION_STATUS,
  summary: 'Get search acceleration status for a table',
  request: { params: z.object({ baseId: z.string(), tableId: z.string() }) },
  responses: {
    200: {
      description: 'Search acceleration status',
      content: { 'application/json': { schema: tableSearchAccelerationStatusSchema } },
    },
  },
  tags: ['table'],
});
export const GetShareSearchAccelerationStatusRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SHARE_SEARCH_ACCELERATION_STATUS,
  summary: 'Get search acceleration availability for a shared view',
  request: { params: z.object({ shareId: z.string() }) },
  responses: {
    200: {
      description: 'Shared view search acceleration status',
      content: { 'application/json': { schema: shareSearchAccelerationStatusSchema } },
    },
  },
  tags: ['share'],
});
export const getTableSearchAccelerationStatus = (baseId: string, tableId: string) =>
  axios.get<ITableSearchAccelerationStatusVo>(
    urlBuilder(GET_TABLE_SEARCH_ACCELERATION_STATUS, { baseId, tableId })
  );
export const getShareSearchAccelerationStatus = (shareId: string) =>
  axios.get<IShareSearchAccelerationStatusVo>(
    urlBuilder(GET_SHARE_SEARCH_ACCELERATION_STATUS, { shareId })
  );
