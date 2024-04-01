import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { contentQueryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const groupPointsRoSchema = contentQueryBaseSchema.pick({
  viewId: true,
  filter: true,
  search: true,
  groupBy: true,
});

export type IGroupPointsRo = z.infer<typeof groupPointsRoSchema>;

export enum GroupPointType {
  Header = 0,
  Row = 1,
}

const groupHeaderPointSchema = z.object({
  id: z.string(),
  type: z.literal(GroupPointType.Header),
  depth: z.number().max(2).min(0),
  value: z.unknown(),
});

const groupRowPointSchema = z.object({
  type: z.literal(GroupPointType.Row),
  count: z.number(),
});

const groupPointSchema = z.union([groupHeaderPointSchema, groupRowPointSchema]);

export type IGroupHeaderPoint = z.infer<typeof groupHeaderPointSchema>;

export type IGroupPoint = z.infer<typeof groupPointSchema>;

export const groupPointsVoSchema = groupPointSchema.array().nullable();

export type IGroupPointsVo = z.infer<typeof groupPointsVoSchema>;

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
