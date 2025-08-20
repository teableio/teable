import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute } from '../../utils';
import { z } from '../../zod';

export const WAITLIST_INVITE_CODE = '/auth/waitlist-invite-code';

export const waitlistInviteCodeRoSchema = z.object({
  count: z.number().int().openapi({
    description: 'The number of invite codes to generate',
    example: 10,
  }),
  times: z.number().int().openapi({
    description: 'The number of invite codes to use',
    example: 10,
  }),
});

export type IWaitlistInviteCodeRo = z.infer<typeof waitlistInviteCodeRoSchema>;

export const waitlistInviteCodeSchemaVo = z.array(
  z.object({
    code: z.string(),
    times: z.number().int(),
  })
);

export type IWaitlistInviteCodeVo = z.infer<typeof waitlistInviteCodeSchemaVo>;

export const WaitlistInviteCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: WAITLIST_INVITE_CODE,
  description: 'Gen waitlist invite code',
  request: {
    body: {
      content: {
        'application/json': {
          schema: waitlistInviteCodeRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Gen waitlist invite code successfully',
      content: {
        'application/json': {
          schema: waitlistInviteCodeSchemaVo,
        },
      },
    },
  },
  tags: ['auth', 'waitlist'],
});

export const genWaitlistInviteCode = async (body: IWaitlistInviteCodeRo) => {
  return axios.post<IWaitlistInviteCodeVo>(WAITLIST_INVITE_CODE, body);
};
