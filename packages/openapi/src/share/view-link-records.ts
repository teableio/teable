import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { getRecordsRoSchema, recordsVoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_LINK_RECORDS = '/share/{shareId}/view/link-records';

export const shareViewLinkRecordsRoSchema = getRecordsRoSchema
  .omit({
    viewId: true,
    projection: true,
    filterLinkCellSelected: true,
  })
  .extend({
    tableId: z.string(),
  });

export type IShareViewLinkRecordsRo = z.infer<typeof shareViewLinkRecordsRoSchema>;

export const shareViewLinkRecordsVoSchema = recordsVoSchema;

export type IShareViewLinkRecordsVo = z.infer<typeof shareViewLinkRecordsVoSchema>;

export const ShareViewLinkRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_LINK_RECORDS,
  description: 'Link records in Share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewLinkRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'Link records',
      content: {
        'application/json': {
          schema: shareViewLinkRecordsVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewLinkRecords = async (shareId: string, query: IShareViewLinkRecordsRo) => {
  return axios.get<IShareViewLinkRecordsVo>(urlBuilder(SHARE_VIEW_LINK_RECORDS, { shareId }), {
    params: query,
  });
};
