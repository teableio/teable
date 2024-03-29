import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import type { IAnalyzeRo, IAnalyzeVo } from './types';
import { analyzeRoSchema, analyzeVoSchema } from './types';

export const ANALYZE_FILE = '/import/analyze';

export const AnalyzeTableRoute: RouteConfig = registerRoute({
  method: 'get',
  path: ANALYZE_FILE,
  description: 'Get a column info from analyze sheet',
  request: {
    query: analyzeRoSchema,
  },
  responses: {
    200: {
      description: 'Returns columnHeader analyze from file',
      content: {
        'application/json': {
          schema: analyzeVoSchema,
        },
      },
    },
  },
  tags: ['import'],
});

export const analyzeFile = async (analyzeRo: IAnalyzeRo) => {
  return axios.get<IAnalyzeVo>(urlBuilder(ANALYZE_FILE), { params: analyzeRo });
};
