import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const RESET_ARCHIVE = '/table/{tableId}/archive/reset';

export const ResetArchiveRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: RESET_ARCHIVE,
  summary: 'Clear table archive',
  description: 'Permanently delete all archive snapshots of the table. This cannot be undone.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Archive cleared successfully',
    },
  },
  tags: ['archive'],
});

export const resetArchive = async (tableId: string) => {
  return axios.delete<null>(urlBuilder(RESET_ARCHIVE, { tableId }));
};
