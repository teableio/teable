import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema } from '@teable/core';
import { axios } from '../axios';
import { userMapVoSchema } from '../trash';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

const recordHistoryArrayQuerySchema = z
  .union([z.string(), z.string().array()])
  .transform((val) => (typeof val === 'string' ? [val] : val))
  .optional()
  .meta({
    type: 'array',
    items: { type: 'string' },
  });

export const getRecordHistoryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  fieldIds: recordHistoryArrayQuerySchema,
  createdByIds: recordHistoryArrayQuerySchema,
  cursor: z.string().nullish(),
});

export const recordHistoryItemStateVoSchema = z.object({
  meta: fieldVoSchema
    .pick({
      name: true,
      type: true,
      cellValueType: true,
      isLookup: true,
      isConditionalLookup: true,
    })
    .extend({
      options: z.unknown(),
    }),
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

export const serializeRecordHistoryQuery = (params?: IGetRecordHistoryQuery) => {
  const searchParams = new URLSearchParams();

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value == null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => searchParams.append(key, item));
      return;
    }

    searchParams.append(key, value);
  });

  return searchParams.toString();
};

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
    query: getRecordHistoryQuerySchema,
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
    { params: query, paramsSerializer: serializeRecordHistoryQuery }
  );
};
