import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { spaceRolesSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const EMAIL_SPACE_INVITATION = '/space/{spaceId}/invitation/email';

export const emailSpaceInvitationRoSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  role: spaceRolesSchema,
});

export type EmailSpaceInvitationRo = z.infer<typeof emailSpaceInvitationRoSchema>;

export const emailSpaceInvitationVoSchema = z.record(
  z.object({
    invitationId: z.string(),
  })
);

export type EmailInvitationVo = z.infer<typeof emailSpaceInvitationVoSchema>;

export const EmailInvitationRoute: RouteConfig = registerRoute({
  method: 'post',
  path: EMAIL_SPACE_INVITATION,
  description: 'Send invitations by e-mail',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: emailSpaceInvitationRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful response, return invitation information.',
      content: {
        'application/json': {
          schema: emailSpaceInvitationVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});

export const emailSpaceInvitation = (params: {
  spaceId: string;
  emailSpaceInvitationRo: EmailSpaceInvitationRo;
}) => {
  const { spaceId, emailSpaceInvitationRo } = params;
  return axios.post<EmailInvitationVo>(
    urlBuilder(EMAIL_SPACE_INVITATION, { spaceId }),
    emailSpaceInvitationRo
  );
};
