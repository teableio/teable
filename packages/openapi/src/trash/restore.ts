import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const RESTORE_TRASH = '/trash/restore/{trashId}';

export const RestoreTrashRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RESTORE_TRASH,
  description: 'restore a space, base, table, etc.',
  request: {
    params: z.object({
      trashId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'Restored successfully',
    },
  },
  tags: ['space'],
});

export const restoreTrash = async (trashId: string) => {
  return axios.post(
    urlBuilder(RESTORE_TRASH, {
      trashId,
    })
  );
};
