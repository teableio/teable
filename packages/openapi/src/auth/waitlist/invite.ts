import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';

export const INVITE_WAITLIST = '/auth/invite-waitlist';

export const inviteWaitlistRoSchema = z.object({
  list: z.array(z.string().email()),
});

export type IInviteWaitlistRo = z.infer<typeof inviteWaitlistRoSchema>;

export const inviteWaitlistSchemaVo = z.array(
  z.object({
    email: z.string().email(),
    code: z.string(),
    times: z.number(),
  })
);

export type IInviteWaitlistVo = z.infer<typeof inviteWaitlistSchemaVo>;

export const InviteWaitlistRoute: RouteConfig = registerRoute({
  method: 'post',
  path: INVITE_WAITLIST,
  description: 'Invite waitlist',
  request: {
    body: {
      content: {
        'application/json': {
          schema: inviteWaitlistRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Invite waitlist successfully',
      content: {
        'application/json': {
          schema: inviteWaitlistSchemaVo,
        },
      },
    },
  },
  tags: ['auth', 'waitlist'],
});

export const inviteWaitlist = async (body: IInviteWaitlistRo) => {
  return axios.post<IInviteWaitlistVo>(INVITE_WAITLIST, body);
};
