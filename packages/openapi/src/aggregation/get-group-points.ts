import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGroupPointsRo, IGroupPointsVo } from '@teable/core';
import { groupPointsRoSchema, groupPointsVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_GROUP_POINTS = '/table/{tableId}/aggregation/group-points';

export const GetGroupPointsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_GROUP_POINTS,
  description: 'Get group points for the view',
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
    },
  });
};
