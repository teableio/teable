import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const taskStatusCollectionVoSchema = z.object({
  cells: z
    .object({
      recordId: z.string(),
      fieldId: z.string(),
    })
    .array(),
  fieldMap: z.record(
    z.string().startsWith(IdPrefix.Field),
    z.object({
      taskId: z.string().startsWith(IdPrefix.Task),
      completedCount: z.number(),
      totalCount: z.number(),
    })
  ),
});

export type ITaskStatusCollectionVo = z.infer<typeof taskStatusCollectionVoSchema>;

export const GET_TASK_STATUS_COLLECTION = '/table/{tableId}/aggregation/task-status-collection';

export const GetTaskStatusCollectionRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TASK_STATUS_COLLECTION,
  summary: 'Get task status collection',
  description:
    'Returns records and count distribution across task status based on specified date range and fields',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Task status collection for the view',
      content: {
        'application/json': {
          schema: taskStatusCollectionVoSchema,
        },
      },
    },
  },
  tags: ['aggregation'],
});

export const getTaskStatusCollection = async (tableId: string) => {
  return axios.get<ITaskStatusCollectionVo>(urlBuilder(GET_TASK_STATUS_COLLECTION, { tableId }));
};
