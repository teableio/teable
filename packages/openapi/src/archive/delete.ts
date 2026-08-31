import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { archiveRecordIdsRoSchema } from './archive';

export const DELETE_ARCHIVE_ITEMS = '/table/{tableId}/archive/items';

export const deleteArchiveItemsRoSchema = archiveRecordIdsRoSchema;

export type IDeleteArchiveItemsRo = z.infer<typeof deleteArchiveItemsRoSchema>;

export const DeleteArchiveItemsRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_ARCHIVE_ITEMS,
  summary: 'Permanently delete archived records',
  description: 'Permanently delete archive snapshots. This cannot be undone.',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: deleteArchiveItemsRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Permanently deleted successfully',
    },
  },
  tags: ['archive'],
});

export const deleteArchiveItems = async (tableId: string, deleteRo: IDeleteArchiveItemsRo) => {
  return axios.delete<null>(urlBuilder(DELETE_ARCHIVE_ITEMS, { tableId }), { data: deleteRo });
};
