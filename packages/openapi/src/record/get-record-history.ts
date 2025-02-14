import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { userMapVoSchema } from '../trash';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const getRecordHistoryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  cursor: z.string().nullish(),
});

export const recordHistoryItemStateVoSchema = z.object({
  meta: fieldVoSchema.pick({ name: true, type: true, cellValueType: true }).merge(
    z.object({
      options: z.unknown(),
    })
  ),
  data: z.unknown(),
});

export const recordHistoryItemVoSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  fieldId: z.string(),
  before: recordHistoryItemStateVoSchema,
  after: recordHistoryItemStateVoSchema,
  createdTime: z.string(),
  createdBy: z.string(),
});

export type IGetRecordHistoryQuery = z.infer<typeof getRecordHistoryQuerySchema>;

export type IRecordHistoryItemVo = z.infer<typeof recordHistoryItemVoSchema>;

export const recordHistoryVoSchema = z.object({
  historyList: z.array(recordHistoryItemVoSchema),
  userMap: userMapVoSchema,
  nextCursor: z.string().nullish(),
});

export type IRecordHistoryVo = z.infer<typeof recordHistoryVoSchema>;

export const GET_RECORD_HISTORY_URL = '/table/{tableId}/record/{recordId}/history';

export const GetRecordHistoryRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_RECORD_HISTORY_URL,
  summary: 'Get record history',
  description:
    'Retrieve the change history of a specific record, including field modifications and user information.',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Get the history list for a record',
      content: {
        'application/json': {
          schema: recordHistoryVoSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export const getRecordHistory = async (
  tableId: string,
  recordId: string,
  query: IGetRecordHistoryQuery
) => {
  return axios.get<IRecordHistoryVo>(
    urlBuilder(GET_RECORD_HISTORY_URL, {
      tableId,
      recordId,
    }),
    { params: query }
  );
};
