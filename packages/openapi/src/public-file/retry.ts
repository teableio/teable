import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const RETRY_PUBLIC_FILES = '/table/{tableId}/field/{fieldId}/public-file/retry';

export const retryPublicFilesVoSchema = z.object({
  retried: z.number().meta({ description: 'Failed files queued to be copied again' }),
});

export type IRetryPublicFilesVo = z.infer<typeof retryPublicFilesVoSchema>;

export const RetryPublicFilesRoute: RouteConfig = registerRoute({
  method: 'post',
  path: RETRY_PUBLIC_FILES,
  summary: 'Retry failed public files',
  description: 'Copies the files of a public attachment field that failed to copy again.',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    201: {
      description: 'The failed files were queued again',
      content: {
        'application/json': {
          schema: retryPublicFilesVoSchema,
        },
      },
    },
  },
  tags: ['public-file'],
});

export const retryPublicFiles = async (tableId: string, fieldId: string) => {
  return axios.post<IRetryPublicFilesVo>(urlBuilder(RETRY_PUBLIC_FILES, { tableId, fieldId }));
};
