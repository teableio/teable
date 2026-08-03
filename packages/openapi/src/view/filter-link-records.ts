import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_VIEW_FILTER_LINK_RECORDS = '/table/{tableId}/view/{viewId}/filter-link-records';

export const getViewFilterLinkRecordsVoSchema = z.array(
  z.object({
    tableId: z.string(),
    records: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
      })
    ),
  })
);

export type IGetViewFilterLinkRecordsVo = z.infer<typeof getViewFilterLinkRecordsVoSchema>;

export const GetViewFilterLinkRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_VIEW_FILTER_LINK_RECORDS,
  description: 'Getting associated records for a view filter configuration.',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the view to filter the configured records.',
      content: {
        'application/json': {
          schema: getViewFilterLinkRecordsVoSchema,
        },
      },
    },
  },
  tags: ['view'],
});

export const getViewFilterLinkRecords = async (tableId: string, viewId: string) => {
  return axios.get<IGetViewFilterLinkRecordsVo>(
    urlBuilder(GET_VIEW_FILTER_LINK_RECORDS, { tableId, viewId })
  );
};
