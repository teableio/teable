import { fieldVoSchema, recordSchema, shareViewMetaSchema, viewVoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const SHARE_VIEW_GET = '/share/{shareId}/view';

export const shareViewGetVoSchema = z.object({
  viewId: z.string(),
  tableId: z.string(),
  shareId: z.string(),
  shareMeta: shareViewMetaSchema.optional(),
  view: viewVoSchema,
  fields: fieldVoSchema.array(),
  records: recordSchema.array().openapi('first 50 records'),
});

export type ShareViewGetVo = z.infer<typeof shareViewGetVoSchema>;

export const ShareViewGetRouter: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_GET,
  description: 'get share view info',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'share view info',
      content: {
        'application/json': {
          schema: shareViewGetVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const shareViewGet = (shareId: string) => {
  return axios.get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId }));
};
