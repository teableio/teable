import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const GET_BASE_TABLE_SCHEMA = '/plugin/chart/{baseId}/schema';

export const baseTableSchemaVo = z.record(z.string(), z.array(z.string()));

export type IBaseTableSchemaVo = z.infer<typeof baseTableSchemaVo>;

export const GetBaseTableSchemaRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_TABLE_SCHEMA,
  description: 'Get table schema by base id',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns schema of all tables in the base.',
      content: {
        'application/json': {
          schema: baseTableSchemaVo,
        },
      },
    },
  },
  tags: ['plugin', 'chart'],
});

export const getBaseTableSchema = async (baseId: string) => {
  return axios.get<IBaseTableSchemaVo>(urlBuilder(GET_BASE_TABLE_SCHEMA, { baseId }));
};
