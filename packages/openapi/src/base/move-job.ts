import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseDataDbMoveJobStatusVoSchema, type IBaseDataDbMoveJobStatusVo } from './move-data-db';

export const GET_BASE_DATA_DB_MOVE_JOB = '/base/{baseId}/move-job/{jobId}';
export const CANCEL_BASE_DATA_DB_MOVE_JOB = '/base/{baseId}/move-job/{jobId}/cancel';
export const RETRY_BASE_DATA_DB_MOVE_JOB = '/base/{baseId}/move-job/{jobId}/retry';

export const GetBaseDataDbMoveJobRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_DATA_DB_MOVE_JOB,
  description: 'Get status of a cross-data-DB base move job',
  summary: 'Get base data DB move job status',
  request: {
    params: z.object({
      baseId: z.string(),
      jobId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Move job status',
      content: {
        'application/json': {
          schema: baseDataDbMoveJobStatusVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const CancelBaseDataDbMoveJobRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CANCEL_BASE_DATA_DB_MOVE_JOB,
  description: 'Cancel a cross-data-DB base move job (only before switch)',
  summary: 'Cancel base data DB move job',
  request: {
    params: z.object({
      baseId: z.string(),
      jobId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Move job cancelled',
      content: {
        'application/json': {
          schema: baseDataDbMoveJobStatusVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const RetryBaseDataDbMoveJobRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RETRY_BASE_DATA_DB_MOVE_JOB,
  description: 'Retry a failed cross-data-DB base move job',
  summary: 'Retry base data DB move job',
  request: {
    params: z.object({
      baseId: z.string(),
      jobId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Retried move job',
      content: {
        'application/json': {
          schema: baseDataDbMoveJobStatusVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const getBaseDataDbMoveJob = async (baseId: string, jobId: string) => {
  return axios.get<IBaseDataDbMoveJobStatusVo>(
    urlBuilder(GET_BASE_DATA_DB_MOVE_JOB, { baseId, jobId })
  );
};

export const cancelBaseDataDbMoveJob = async (baseId: string, jobId: string) => {
  return axios.post<IBaseDataDbMoveJobStatusVo>(
    urlBuilder(CANCEL_BASE_DATA_DB_MOVE_JOB, { baseId, jobId })
  );
};

export const retryBaseDataDbMoveJob = async (baseId: string, jobId: string) => {
  return axios.post<IBaseDataDbMoveJobStatusVo>(
    urlBuilder(RETRY_BASE_DATA_DB_MOVE_JOB, { baseId, jobId })
  );
};
