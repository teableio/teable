import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { copyVoSchema, rangesSchema, type ICopyRo } from '../selection';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_COPY = '/share/{shareId}/view/copy';

export const shareViewCopyRoSchema = rangesSchema;

export type IShareViewCopyRo = z.infer<typeof shareViewCopyRoSchema>;

export const shareViewCopyVoSchema = copyVoSchema;

export type IShareViewCopyVo = z.infer<typeof shareViewCopyVoSchema>;

export const ShareViewCopyRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_COPY,
  description: 'Copy operations in Share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewCopyRoSchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: shareViewCopyVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const shareViewCopy = async (shareId: string, copyRo: ICopyRo) => {
  return axios.get<IShareViewCopyVo>(
    urlBuilder(SHARE_VIEW_COPY, {
      shareId,
    }),
    { params: copyRo }
  );
};
