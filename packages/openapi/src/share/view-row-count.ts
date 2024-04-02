import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRowCountVo } from '../aggregation';
import { rowCountVoSchema } from '../aggregation';
import { axios } from '../axios';
import { queryBaseSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_ROW_COUNT = '/share/{shareId}/view/row-count';

export const shareViewRowCountRoSchema = queryBaseSchema.omit({
  viewId: true,
});

export type IShareViewRowCountRo = z.infer<typeof shareViewRowCountRoSchema>;

export const ShareViewRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_ROW_COUNT,
  description: 'Get row count for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewRowCountRoSchema,
  },
  responses: {
    200: {
      description: 'Row count for the share view',
      content: {
        'application/json': {
          schema: rowCountVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewRowCount = async (shareId: string, query: IShareViewRowCountRo) => {
  return axios.get<IRowCountVo>(urlBuilder(SHARE_VIEW_ROW_COUNT, { shareId }), {
    params: {
      ...query,
      filter: JSON.stringify(query.filter),
    },
  });
};
