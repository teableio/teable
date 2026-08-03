import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { ICopyVo, IRangesRo } from '../selection';
import { copyVoSchema, rangesQuerySchema } from '../selection';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_COPY = '/share/{shareId}/view/copy';

export const ShareViewCopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_COPY,
  description: 'Copy operations in Share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: rangesQuerySchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: copyVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const shareViewCopy = async (shareId: string, copyRo: IRangesRo) => {
  return axios.get<ICopyVo>(
    urlBuilder(SHARE_VIEW_COPY, {
      shareId,
    }),
    {
      params: {
        ...copyRo,
        filter: JSON.stringify(copyRo.filter),
        orderBy: JSON.stringify(copyRo.orderBy),
        ranges: JSON.stringify(copyRo.ranges),
        groupBy: JSON.stringify(copyRo.groupBy),
        collapsedGroupIds: JSON.stringify(copyRo.collapsedGroupIds),
      },
    }
  );
};
