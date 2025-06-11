import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IGroupPointsVo } from './type';
import { groupPointsVoSchema } from './type';

export const groupPointsRoSchema = contentQueryBaseSchema.pick({
  viewId: true,
  filter: true,
  search: true,
  groupBy: true,
  collapsedGroupIds: true,
  ignoreViewQuery: true,
});

export type IGroupPointsRo = z.infer<typeof groupPointsRoSchema>;

export const GET_GROUP_POINTS = '/table/{tableId}/aggregation/group-points';

export const GetGroupPointsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_GROUP_POINTS,
  summary: 'Get group points',
  description:
    'Returns the distribution and count of records across different group points in the view',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: groupPointsRoSchema,
  },
  responses: {
    200: {
      description: 'Group points for the view',
      content: {
        'application/json': {
          schema: groupPointsVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getGroupPoints = async (tableId: string, query?: IGroupPointsRo) => {
  return axios.get<IGroupPointsVo>(urlBuilder(GET_GROUP_POINTS, { tableId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
      groupBy: JSON.stringify(query?.groupBy),
      collapsedGroupIds: JSON.stringify(query?.collapsedGroupIds),
    },
  });
};
