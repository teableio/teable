import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseShareVoSchema, createBaseShareRoSchema } from './types';

export const CREATE_BASE_SHARE = '/base/{baseId}/share';

export const CreateBaseShareRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE_SHARE,
  description: 'Create a base share link',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createBaseShareRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the created base share',
      content: {
        'application/json': {
          schema: baseShareVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const createBaseShare = (baseId: string, data: z.infer<typeof createBaseShareRoSchema>) => {
  return axios.post<z.infer<typeof baseShareVoSchema>>(
    urlBuilder(CREATE_BASE_SHARE, { baseId }),
    data
  );
};
