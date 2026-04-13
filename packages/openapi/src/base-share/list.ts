import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const LIST_BASE_SHARE = '/base/{baseId}/share';

// List only returns nodeId for marking which nodes have shares
export const listBaseShareItemSchema = z.object({
  nodeId: z.string().nullable(),
});

export const listBaseShareVoSchema = z.array(listBaseShareItemSchema);

export type IListBaseShareVo = z.infer<typeof listBaseShareVoSchema>;

export const ListBaseShareRoute: RouteConfig = registerRoute({
  method: 'get',
  path: LIST_BASE_SHARE,
  description: 'Get all shared node IDs for a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns list of shared node IDs',
      content: {
        'application/json': {
          schema: listBaseShareVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const listBaseShare = (baseId: string) => {
  return axios.get<IListBaseShareVo>(urlBuilder(LIST_BASE_SHARE, { baseId }));
};
