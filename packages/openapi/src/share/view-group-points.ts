import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGroupPointsRo, IGroupPointsVo } from '@teable-group/core';
import { groupPointsRoSchema, groupPointsVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_GROUP_POINTS = '/share/{shareId}/view/groupPoints';

export const ShareViewGroupPointsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_GROUP_POINTS,
  description: 'Get group points for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: groupPointsRoSchema,
  },
  responses: {
    200: {
      description: 'Group points for the share view',
      content: {
        'application/json': {
          schema: groupPointsVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewGroupPoints = async (shareId: string, query?: IGroupPointsRo) => {
  return axios.get<IGroupPointsVo>(urlBuilder(SHARE_VIEW_GROUP_POINTS, { shareId }), {
    params: query,
  });
};
