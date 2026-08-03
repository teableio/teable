import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { baseRolesSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_BASE_INVITATION_LINK = '/base/{baseId}/invitation/link/{invitationId}';

export const updateBaseInvitationLinkRoSchema = z.object({
  role: baseRolesSchema,
});

export type UpdateBaseInvitationLinkRo = z.infer<typeof updateBaseInvitationLinkRoSchema>;

export const updateBaseInvitationLinkVoSchema = z.object({
  invitationId: z.string(),
  role: baseRolesSchema,
});

export type UpdateBaseInvitationLinkVo = z.infer<typeof updateBaseInvitationLinkVoSchema>;

export const UpdateBaseInvitationLinkRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_BASE_INVITATION_LINK,
  description: 'Update a invitation link to your',
  request: {
    params: z.object({
      invitationId: z.string(),
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseInvitationLinkRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful response.',
      content: {
        'application/json': {
          schema: updateBaseInvitationLinkVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const updateBaseInvitationLink = (params: {
  baseId: string;
  invitationId: string;
  updateBaseInvitationLinkRo: UpdateBaseInvitationLinkRo;
}) => {
  const { baseId, invitationId, updateBaseInvitationLinkRo } = params;
  return axios.patch<UpdateBaseInvitationLinkVo>(
    urlBuilder(UPDATE_BASE_INVITATION_LINK, { baseId, invitationId }),
    updateBaseInvitationLinkRo
  );
};
