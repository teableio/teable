import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRowCountVo } from '@teable-group/core';
import { rowCountVoSchema, aggregationRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { paramsSerializer, registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_ROW_COUNT = '/share/{shareId}/view/rowCount';

export const shareViewRowCountQuerySchema = aggregationRoSchema.pick({
  filter: true,
});

export const shareViewRowCountQueryRoSchema = z.object({
  query: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value) {
        const parsingResult = shareViewRowCountQuerySchema.safeParse(JSON.parse(value));
        if (!parsingResult.success) {
          parsingResult.error.issues.forEach((issue) => {
            ctx.addIssue(issue);
          });
          return z.NEVER;
        }
        return parsingResult.data;
      }
      return value;
    }),
});

export type IShareViewRowCountQueryRo = z.infer<typeof shareViewRowCountQueryRoSchema>;

export type IShareViewRowCountQuery = z.infer<typeof shareViewRowCountQuerySchema>;

export const ShareViewRowCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_ROW_COUNT,
  description: 'Get row count for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewRowCountQueryRoSchema,
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

export const getShareViewRowCount = async (shareId: string, query: IShareViewRowCountQueryRo) => {
  return axios.get<IRowCountVo>(urlBuilder(SHARE_VIEW_ROW_COUNT, { shareId }), {
    params: query,
    paramsSerializer,
  });
};
