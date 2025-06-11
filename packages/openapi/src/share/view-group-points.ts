import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGroupPointsVo } from '../aggregation';
import { groupPointsRoSchema, groupPointsVoSchema } from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_GROUP_POINTS = '/share/{shareId}/view/group-points';

export const shareViewGroupPointsRoSchema = groupPointsRoSchema.omit({
  viewId: true,
});

export type IShareViewGroupPointsRo = z.infer<typeof shareViewGroupPointsRoSchema>;

export const ShareViewGroupPointsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_GROUP_POINTS,
  description: 'Get group points for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewGroupPointsRoSchema,
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

export const getShareViewGroupPoints = async (shareId: string, query?: IShareViewGroupPointsRo) => {
  return axios.get<IGroupPointsVo>(urlBuilder(SHARE_VIEW_GROUP_POINTS, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query?.filter),
      groupBy: JSON.stringify(query?.groupBy),
      collapsedGroupIds: JSON.stringify(query?.collapsedGroupIds),
    },
  });
};
