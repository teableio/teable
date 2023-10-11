import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { spaceRolesSchema } from '@teable-group/core';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_SPACE_INVITATION_LINK = '/space/{spaceId}/invitation/link';

export const createSpaceInvitationLinkRoSchema = z.object({
  role: spaceRolesSchema,
});

export type CreateSpaceInvitationLinkRo = z.infer<typeof createSpaceInvitationLinkRoSchema>;

export const createSpaceInvitationLinkVoSchema = z.object({
  invitationId: z.string(),
});

export type CreateSpaceInvitationLinkVo = z.infer<typeof createSpaceInvitationLinkVoSchema>;

export const CreateSpaceInvitationLinkRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_SPACE_INVITATION_LINK,
  description: 'Create a invitation link to your',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createSpaceInvitationLinkRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful response, return the ID of the invitation link.',
      content: {
        'application/json': {
          schema: createSpaceInvitationLinkVoSchema,
        },
      },
    },
  },
  tags: ['space'],
});
