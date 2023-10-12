import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const DELETE_SPACE_INVITATION_LINK = '/space/{spaceId}/invitation/link/{invitationId}';

export const DeleteSpaceInvitationLinkRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_SPACE_INVITATION_LINK,
  description: 'Delete a invitation link to your',
  request: {
    params: z.object({
      spaceId: z.string(),
      invitationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Successful response.',
    },
  },
  tags: ['space'],
});
