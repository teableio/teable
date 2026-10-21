import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_TRASH = '/trash/{trashId}';

export const deleteTrashQuerySchema = z.object({
  force: z
    .union([
      z.boolean(),
      z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .meta({ type: 'string' }),
    ])
    .optional()
    .describe(
      'Explicitly remove a deleted BYODB space without cleaning its external database. External data may remain and must be cleaned manually. Not supported for other trash items.'
    ),
});

export type IDeleteTrashQuery = z.infer<typeof deleteTrashQuerySchema>;

export const DeleteTrashRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_TRASH,
  description: 'Permanently delete a trash item by trashId',
  request: {
    params: z.object({
      trashId: z.string(),
    }),
    query: deleteTrashQuerySchema,
  },
  responses: {
    200: {
      description: 'Permanently deleted successfully',
    },
  },
  tags: ['trash'],
});

export const deleteTrash = async (trashId: string, query?: IDeleteTrashQuery) => {
  return await axios.delete<null>(urlBuilder(DELETE_TRASH, { trashId }), { params: query });
};
