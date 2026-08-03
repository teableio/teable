import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { baseRolesSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { itemBaseInvitationLinkVoSchema } from './invitation-get-link-list';

export const CREATE_BASE_INVITATION_LINK = '/base/{baseId}/invitation/link';

export const createBaseInvitationLinkRoSchema = z.object({
  role: baseRolesSchema,
});

export type CreateBaseInvitationLinkRo = z.infer<typeof createBaseInvitationLinkRoSchema>;

export const createBaseInvitationLinkVoSchema = itemBaseInvitationLinkVoSchema;

export type CreateBaseInvitationLinkVo = z.infer<typeof createBaseInvitationLinkVoSchema>;

export const CreateBaseInvitationLinkRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_BASE_INVITATION_LINK,
  description: 'Create a invitation link to your',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createBaseInvitationLinkRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Successful response, return the ID of the invitation link.',
      content: {
        'application/json': {
          schema: createBaseInvitationLinkVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const createBaseInvitationLink = (params: {
  baseId: string;
  createBaseInvitationLinkRo: CreateBaseInvitationLinkRo;
}) => {
  const { baseId, createBaseInvitationLinkRo } = params;
  return axios.post<CreateBaseInvitationLinkVo>(
    urlBuilder(CREATE_BASE_INVITATION_LINK, { baseId }),
    createBaseInvitationLinkRo
  );
};
