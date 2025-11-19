import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import { baseQuerySchemaVoV2, type IBaseQueryVoV2 } from './dashboard-query-v2';

export const GET_DASHBOARD_INSTALL_TEST_SQL = '/plugin/chart/test-sql';

export const testSqlRoSchema = z.object({
  sql: z.string().nullable(),
  baseId: z.string(),
});

export type ITestSqlRo = z.infer<typeof testSqlRoSchema>;

export const GetDashboardInstallPluginSqlRoute: RouteConfig = registerRoute({
  method: 'post',
  path: GET_DASHBOARD_INSTALL_TEST_SQL,
  description: 'Get a dashboard install plugin query by id',
  request: {
    params: z.object({
      pluginInstallId: z.string(),
      positionId: z.string(),
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: testSqlRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the dashboard install plugin query.',
      content: {
        'application/json': {
          schema: baseQuerySchemaVoV2,
        },
      },
    },
  },
  tags: ['plugin', 'chart', 'dashboard'],
});

export const getDashboardTestSqlResult = async (baseId: string, sql: string) => {
  return axios.post<IBaseQueryVoV2>(urlBuilder(GET_DASHBOARD_INSTALL_TEST_SQL), {
    sql,
    baseId,
  });
};
