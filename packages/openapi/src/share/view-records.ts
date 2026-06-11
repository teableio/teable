import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { IRecordsVo } from '../record';
import { getRecordsRoSchema, recordsVoSchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_RECORDS = '/share/{shareId}/view/records';

export const shareViewRecordsRoSchema = getRecordsRoSchema.omit({
  // The share view is the security boundary: viewId is bound by the shareId, and
  // ignoreViewQuery must not be exposed — it would let a client drop the view scope
  // and read records the view filter hides (data leak). Selection ops reject it too.
  viewId: true,
  ignoreViewQuery: true,
});

export type IShareViewRecordsRo = z.infer<typeof shareViewRecordsRoSchema>;

export const ShareViewRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: SHARE_VIEW_RECORDS,
  description: 'Get records for the share view',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewRecordsRoSchema,
  },
  responses: {
    200: {
      description: 'Records for the share view',
      content: {
        'application/json': {
          schema: recordsVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewRecords = async (shareId: string, query: IShareViewRecordsRo) => {
  return axios.get<IRecordsVo>(urlBuilder(SHARE_VIEW_RECORDS, { shareId }), {
    params: {
      ...query,
      filter: query.filter ? JSON.stringify(query.filter) : undefined,
      orderBy: query.orderBy ? JSON.stringify(query.orderBy) : undefined,
      groupBy: query.groupBy ? JSON.stringify(query.groupBy) : undefined,
    },
  });
};
