import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { recordSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_FORM_SUBMIT = '/share/{shareId}/view/formSubmit';

export const shareViewFormSubmitRoSchema = z.object({
  fields: recordSchema.shape.fields,
});

export type ShareViewFormSubmitRo = z.infer<typeof shareViewFormSubmitRoSchema>;

export const shareViewFormSubmitVoSchema = recordSchema;

export type ShareViewFormSubmitVo = z.infer<typeof shareViewFormSubmitVoSchema>;

export const ShareViewFormSubmitRouter: RouteConfig = registerRoute({
  method: 'post',
  path: SHARE_VIEW_FORM_SUBMIT,
  description: 'share form view submit new record',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: shareViewFormSubmitRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successfully submit',
      content: {
        'application/json': {
          schema: shareViewFormSubmitVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const shareViewFormSubmit = (params: {
  shareId: string;
  fields: Record<string, unknown>;
}) => {
  const { shareId, fields } = params;
  return axios.post<ShareViewFormSubmitVo>(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId }), {
    fields,
  });
};
