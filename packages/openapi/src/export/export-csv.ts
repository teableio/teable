import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const EXPORT_CSV_FROM_TABLE = '/export/{tableId}';

export const ExportCsvFromTableRoute: RouteConfig = registerRoute({
  method: 'get',
  path: EXPORT_CSV_FROM_TABLE,
  description: 'export csv from table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: z.object({
      viewId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Download successful',
    },
  },
  tags: ['export'],
});

export const exportCsvFromTable = async (tableId: string, viewId?: string) => {
  return axios.get(urlBuilder(EXPORT_CSV_FROM_TABLE, { tableId }), {
    params: { viewId },
  });
};
