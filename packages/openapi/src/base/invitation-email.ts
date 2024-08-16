import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { baseRolesSchema } from '@teable/core';
import { axios } from '../axios';
import type { EmailInvitationVo } from '../space';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const EMAIL_BASE_INVITATION = '/base/{baseId}/invitation/email';

export const emailBaseInvitationRoSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  role: baseRolesSchema,
});

export type EmailBaseInvitationRo = z.infer<typeof emailBaseInvitationRoSchema>;

export const emailBaseInvitationVoSchema = z.record(
  z.object({
    invitationId: z.string(),
  })
);

export const EmailBaseInvitationRoute: RouteConfig = registerRoute({
  method: 'post',
  path: EMAIL_BASE_INVITATION,
  description: 'Send invitations by e-mail',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: emailBaseInvitationRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful response, return invitation information.',
      content: {
        'application/json': {
          schema: emailBaseInvitationVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const emailBaseInvitation = (params: {
  baseId: string;
  emailBaseInvitationRo: EmailBaseInvitationRo;
}) => {
  const { baseId, emailBaseInvitationRo } = params;
  return axios.post<EmailInvitationVo>(
    urlBuilder(EMAIL_BASE_INVITATION, { baseId }),
    emailBaseInvitationRo
  );
};
