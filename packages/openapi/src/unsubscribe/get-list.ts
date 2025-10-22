import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_UNSUBSCRIBE_LIST = '/unsubscribe/list/{baseId}';

export const unsubscribeItemVoSchema = z.object({
  email: z.string(),
  createdTime: z.string(),
});

export type IUnsubscribeItemVo = z.infer<typeof unsubscribeItemVoSchema>;

export const unsubscribeListVoSchema = z.array(unsubscribeItemVoSchema);

export type IUnsubscribeListVo = z.infer<typeof unsubscribeListVoSchema>;

export const unsubscribeListPaginatedVoSchema = z.object({
  data: unsubscribeListVoSchema,
  hasMore: z.boolean(),
  pageSize: z.number(),
});

export type IUnsubscribeListPaginatedVo = z.infer<typeof unsubscribeListPaginatedVoSchema>;

export const getUnSubscribeListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_UNSUBSCRIBE_LIST,
  description: 'Get paginated unsubscribe list by baseId',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: z.object({
      pageSize: z.coerce.number().int().min(1).max(100).default(10).optional(),
      cursor: z.string().optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Returns paginated unsubscribe list.',
      content: {
        'application/json': {
          schema: unsubscribeListPaginatedVoSchema,
        },
      },
    },
  },
  tags: ['unsubscribe'],
});

export const getUnSubscribeList = async (
  baseId: string,
  params?: { pageSize?: number; cursor?: string; search?: string }
) => {
  return axios.get<IUnsubscribeListPaginatedVo>(urlBuilder(GET_UNSUBSCRIBE_LIST, { baseId }), {
    params,
  });
};
