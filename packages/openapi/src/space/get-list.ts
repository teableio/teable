import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';
import type { IGetSpaceVo } from './get';
import { getSpaceVoSchema } from './get';

export const GET_SPACE_LIST = '/space';

export const GetSpaceListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SPACE_LIST,
  description: 'Get space list by query',
  request: {},
  responses: {
    200: {
      description: 'Returns the list of space.',
      content: {
        'application/json': {
          schema: z.array(getSpaceVoSchema),
        },
      },
    },
  },
  tags: ['space'],
});

export const getSpaceList = async () => {
  return axios.get<IGetSpaceVo[]>(GET_SPACE_LIST);
};
