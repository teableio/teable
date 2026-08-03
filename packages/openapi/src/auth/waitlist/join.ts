import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';

export const JOIN_WAITLIST = '/auth/join-waitlist';

export const joinWaitlistSchemaRo = z.object({
  email: z.string().email(),
});

export type IJoinWaitlistRo = z.infer<typeof joinWaitlistSchemaRo>;

export const joinWaitlistSchemaVo = joinWaitlistSchemaRo;

export type IJoinWaitlistVo = z.infer<typeof joinWaitlistSchemaVo>;

export const JoinWaitlistRoute: RouteConfig = registerRoute({
  method: 'post',
  path: JOIN_WAITLIST,
  description: 'Join waitlist',
  request: {
    body: {
      content: {
        'application/json': {
          schema: joinWaitlistSchemaRo,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Join waitlist successfully',
      content: {
        'application/json': {
          schema: joinWaitlistSchemaVo,
        },
      },
    },
  },
  tags: ['auth', 'waitlist'],
});

export const joinWaitlist = async (body: IJoinWaitlistRo) => {
  return axios.post<IJoinWaitlistVo>(JOIN_WAITLIST, body);
};
