import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DEVICE_APP_GET = '/oauth/device/{userCode}';

export const deviceAppGetVoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  homepage: z.string().url(),
  logo: z.string().url().optional(),
  scopes: z.array(z.string()),
});

export type DeviceAppGetVo = z.infer<typeof deviceAppGetVoSchema>;

export const deviceAppGetRoute = registerRoute({
  method: 'get',
  path: DEVICE_APP_GET,
  description: 'Get the application waiting on a device user code',
  request: {
    params: z.object({
      userCode: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the application requesting authorization',
      content: {
        'application/json': {
          schema: deviceAppGetVoSchema,
        },
      },
    },
  },
  tags: ['oauth'],
});

export const deviceAppGet = async (userCode: string) => {
  return axios.get<DeviceAppGetVo>(urlBuilder(DEVICE_APP_GET, { userCode }));
};
