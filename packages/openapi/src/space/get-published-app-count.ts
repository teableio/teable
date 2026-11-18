import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_SPACE_PUBLISHED_APP_COUNT = '/space/{spaceId}/published-app-count';

export const spacePublishedAppCountVoSchema = z.object({
  count: z.number(),
});

export type ISpacePublishedAppCountVo = z.infer<typeof spacePublishedAppCountVoSchema>;

export const GetSpacePublishedAppCountRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_SPACE_PUBLISHED_APP_COUNT,
  description:
    'Count the published apps in the projects of a space: the apps that go offline when the space is moved to the trash.',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'The number of published apps',
      content: {
        'application/json': {
          schema: spacePublishedAppCountVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const getSpacePublishedAppCount = async (spaceId: string) => {
  return axios.get<ISpacePublishedAppCountVo>(
    urlBuilder(GET_SPACE_PUBLISHED_APP_COUNT, { spaceId })
  );
};
