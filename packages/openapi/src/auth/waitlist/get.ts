import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';

export const GET_WAITLIST = '/auth/waitlist';

export const getWaitlistSchemaVo = z.array(
  z.object({
    email: z.string().email(),
    invite: z.boolean().nullable(),
    inviteTime: z.date().nullable(),
    createdTime: z.date(),
  })
);

export type IGetWaitlistVo = z.infer<typeof getWaitlistSchemaVo>;

export const GetWaitlistRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_WAITLIST,
  description: 'Get waitlist',
  request: {},
  responses: {
    200: {
      description: 'Get waitlist successfully',
      content: {
        'application/json': {
          schema: getWaitlistSchemaVo,
        },
      },
    },
  },
  tags: ['auth', 'waitlist'],
});

export const getWaitlist = async () => {
  return axios.get<IGetWaitlistVo>(GET_WAITLIST);
};
