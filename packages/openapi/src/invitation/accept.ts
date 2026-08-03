import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix } from '@teable/core';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const ACCEPT_INVITATION_LINK = '/invitation/link/accept';

export const acceptInvitationLinkRoSchema = z.object({
  invitationCode: z.string(),
  invitationId: z.string().startsWith(IdPrefix.Invitation),
});

export type AcceptInvitationLinkRo = z.infer<typeof acceptInvitationLinkRoSchema>;

export const acceptInvitationLinkVoSchema = z.object({
  spaceId: z.string().nullable(),
  baseId: z.string().nullable(),
});

export type AcceptInvitationLinkVo = z.infer<typeof acceptInvitationLinkVoSchema>;

export const AcceptInvitationLinkRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ACCEPT_INVITATION_LINK,
  description: 'Accept invitation link',
  request: {
    body: {
      content: {
        'application/json': {
          schema: acceptInvitationLinkRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful response, return the spaceId or baseId of the invitation link.',
      content: {
        'application/json': {
          schema: acceptInvitationLinkVoSchema,
        },
      },
    },
  },
  tags: ['invitation'],
});

export const acceptInvitationLink = (acceptInvitationLinkRo: AcceptInvitationLinkRo) => {
  return axios.post<AcceptInvitationLinkVo>(ACCEPT_INVITATION_LINK, acceptInvitationLinkRo);
};
