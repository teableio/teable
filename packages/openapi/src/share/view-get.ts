import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema, recordSchema, shareViewMetaSchema, viewVoSchema } from '@teable/core';
import { groupPointsVoSchema } from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { getViewInstallPluginVoSchema } from '../view/plugin-get';
import { z } from '../zod';

export const SHARE_VIEW_GET = '/share/{shareId}/view';

const shareViewPluginSchema = getViewInstallPluginVoSchema.omit({ baseId: true });
export type IShareViewPlugin = z.infer<typeof shareViewPluginSchema>;

export const shareViewGetVoSchema = z.object({
  viewId: z.string().optional(),
  tableId: z.string(),
  shareId: z.string(),
  shareMeta: shareViewMetaSchema.optional(),
  view: viewVoSchema.optional(),
  fields: fieldVoSchema.array(),
  records: recordSchema.array().openapi({ description: 'first 50 records' }),
  extra: z
    .object({
      groupPoints: groupPointsVoSchema.optional().openapi({
        description: 'Group points for the view',
      }),
      plugin: shareViewPluginSchema.optional(),
    })
    .optional(),
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

export const getShareView = (shareId: string) => {
  return axios.get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId }));
};
