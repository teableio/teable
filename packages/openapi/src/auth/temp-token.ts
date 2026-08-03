import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const GET_TEMP_TOKEN = '/auth/temp-token';

export const getTempTokenVoSchema = z.object({
  accessToken: z.string(),
  expiresTime: z.string(),
});

export type IGetTempTokenVo = z.infer<typeof getTempTokenVoSchema>;

export const getTempTokenRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_TEMP_TOKEN,
  description: 'Get temp token',
  responses: {
    200: {
      description: 'Get temp token successfully',
      content: {
        'application/json': {
          schema: getTempTokenVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const getTempToken = () => axios.get<IGetTempTokenVo>(GET_TEMP_TOKEN);
