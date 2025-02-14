import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { getViewFilterLinkRecordsVoSchema } from '../view/filter-link-records';
import { z } from '../zod';

export const GET_FIELD_FILTER_LINK_RECORDS = '/table/{tableId}/field/{fieldId}/filter-link-records';

export const getFieldFilterLinkRecordsVoSchema = getViewFilterLinkRecordsVoSchema;

export type IGetFieldFilterLinkRecordsVo = z.infer<typeof getFieldFilterLinkRecordsVoSchema>;

export const GetFieldFilterLinkRecordsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_FIELD_FILTER_LINK_RECORDS,
  summary: 'Get linked records for filter',
  description:
    'Retrieve associated records that match the view filter configuration for a linked field',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the link field to filter the configured records.',
      content: {
        'application/json': {
          schema: getFieldFilterLinkRecordsVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const getFieldFilterLinkRecords = async (tableId: string, fieldId: string) => {
  return axios.get<IGetFieldFilterLinkRecordsVo>(
    urlBuilder(GET_FIELD_FILTER_LINK_RECORDS, { tableId, fieldId })
  );
};
