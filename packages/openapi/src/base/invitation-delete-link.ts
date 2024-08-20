import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DELETE_BASE_INVITATION_LINK = '/base/{baseId}/invitation/link/{invitationId}';

export const DeleteBaseInvitationLinkRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_BASE_INVITATION_LINK,
  description: 'Delete a invitation link to your',
  request: {
    params: z.object({
      baseId: z.string(),
      invitationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['base'],
});

export const deleteBaseInvitationLink = (params: { baseId: string; invitationId: string }) => {
  const { baseId, invitationId } = params;
  return axios.delete(urlBuilder(DELETE_BASE_INVITATION_LINK, { baseId, invitationId }));
};
