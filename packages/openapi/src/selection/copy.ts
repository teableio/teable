import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IRangesRo } from './range';
import { rangesQuerySchema } from './range';

export const COPY_URL = '/table/{tableId}/selection/copy';

export const copyVoSchema = z.object({
  content: z.string(),
  header: fieldVoSchema.array(),
});

export type ICopyVo = z.infer<typeof copyVoSchema>;

export const CopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: COPY_URL,
  summary: 'Copy selected table content',
  description: 'Copy content from selected table ranges including headers if specified',
  request: {
    params: z.object({
      tableId: z.string(),
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
  tags: ['selection'],
});

export const copy = async (tableId: string, copyRo: IRangesRo) => {
  return axios.get<ICopyVo>(
    urlBuilder(COPY_URL, {
      tableId,
    }),
    {
      params: {
        ...copyRo,
        filter: JSON.stringify(copyRo.filter),
        orderBy: JSON.stringify(copyRo.orderBy),
        groupBy: JSON.stringify(copyRo.groupBy),
        ranges: JSON.stringify(copyRo.ranges),
        collapsedGroupIds: JSON.stringify(copyRo.collapsedGroupIds),
      },
    }
  );
};
