import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { roleSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { itemSpaceInvitationLinkVoSchema } from './invitation-get-link-list';

export const CREATE_SPACE_INVITATION_LINK = '/space/{spaceId}/invitation/link';

export const createSpaceInvitationLinkRoSchema = z.object({
  role: roleSchema,
});

export type CreateSpaceInvitationLinkRo = z.infer<typeof createSpaceInvitationLinkRoSchema>;

export const createSpaceInvitationLinkVoSchema = itemSpaceInvitationLinkVoSchema;

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

export const createSpaceInvitationLink = (params: {
  spaceId: string;
  createSpaceInvitationLinkRo: CreateSpaceInvitationLinkRo;
}) => {
  const { spaceId, createSpaceInvitationLinkRo } = params;
  return axios.post<CreateSpaceInvitationLinkVo>(
    urlBuilder(CREATE_SPACE_INVITATION_LINK, { spaceId }),
    createSpaceInvitationLinkRo
  );
};
