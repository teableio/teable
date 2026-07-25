import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { crossSpaceAffectedFieldSchema } from './move';
import { moveBaseDataDbCheckSchema } from './move-data-db';

export const MOVE_BASE_CHECK = '/base/{baseId}/move-check';

export const moveBaseCheckVoSchema = z.object({
  affectedFields: z.array(crossSpaceAffectedFieldSchema),
  dataDb: moveBaseDataDbCheckSchema.optional(),
});

export type IMoveBaseCheckVo = z.infer<typeof moveBaseCheckVoSchema>;

export const MoveBaseCheckRoute: RouteConfig = registerRoute({
  method: 'get',
  path: MOVE_BASE_CHECK,
  description:
    'Check the cross-space link/lookup/rollup fields that would be converted if this base were moved into the given target space (both outgoing and incoming references), and whether a physical cross-data-DB move is required.',
  summary: 'Check cross-space affected fields for base move',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'The list of cross-space affected fields and data-DB move requirements.',
      content: {
        'application/json': {
          schema: moveBaseCheckVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const moveBaseCheck = async (baseId: string, spaceId: string) => {
  return axios.get<IMoveBaseCheckVo>(urlBuilder(MOVE_BASE_CHECK, { baseId }), {
    params: { spaceId },
  });
};
