import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IDbConnectionVo } from './create';
import { dbConnectionVoSchema } from './create';

export const GET_DB_CONNECTION = '/base/{baseId}/connection';

export const GetDbConnectionRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_DB_CONNECTION,
  description: 'Get db connection info',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns information about a db connection.',
      content: {
        'application/json': {
          schema: dbConnectionVoSchema.optional(),
        },
      },
    },
  },
  tags: ['db-connection'],
});

export const getDbConnection = async (baseId: string) => {
  return axios.get<IDbConnectionVo | null>(
    urlBuilder(GET_DB_CONNECTION, {
      baseId,
    })
  );
};
