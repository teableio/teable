import { axios } from '../axios';
import { PrincipalType } from '../space/types';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const SHARE_VIEW_COLLABORATORS = '/share/{shareId}/view/collaborators';

export const shareViewCollaboratorsRoSchema = z.object({
  fieldId: z.string().optional(),
  skip: z.coerce.number().optional(),
  take: z.coerce.number().optional(),
  search: z.string().optional(),
  type: z.nativeEnum(PrincipalType).optional(),
});

export type IShareViewCollaboratorsRo = z.infer<typeof shareViewCollaboratorsRoSchema>;

export const shareViewCollaboratorsVoSchema = z.array(
  z.object({
    userId: z.string(),
    userName: z.string(),
    email: z.string(),
    avatar: z.string().nullable().optional(),
  })
);

export type IShareViewCollaboratorsVo = z.infer<typeof shareViewCollaboratorsVoSchema>;

export const ShareViewCollaboratorsRoute = registerRoute({
  method: 'get',
  path: SHARE_VIEW_COLLABORATORS,
  description: 'View collaborators in a view with a user field selector.',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    query: shareViewCollaboratorsRoSchema,
  },
  responses: {
    200: {
      description: ' view collaborators',
      content: {
        'application/json': {
          schema: shareViewCollaboratorsVoSchema,
        },
      },
    },
  },
  tags: ['share'],
});

export const getShareViewCollaborators = async (
  shareId: string,
  query?: IShareViewCollaboratorsRo
) => {
  return axios.get<IShareViewCollaboratorsVo>(urlBuilder(SHARE_VIEW_COLLABORATORS, { shareId }), {
    params: query,
  });
};
