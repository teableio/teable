import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const UPDATE_SPACE_AVATAR = '/space/{spaceId}/avatar';

export const updateSpaceAvatarRoSchema = z.object({
  file: z.string().meta({ format: 'binary' }),
});

export type IUpdateSpaceAvatarRo = z.infer<typeof updateSpaceAvatarRoSchema>;

export const UpdateSpaceAvatarRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_SPACE_AVATAR,
  description: 'Update space avatar',
  request: {
    params: z.object({
      spaceId: z.string(),
    }),
    body: {
      content: {
        'multipart/form-data': {
          schema: updateSpaceAvatarRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['space'],
});

export const updateSpaceAvatar = async (spaceId: string, updateSpaceAvatarRo: FormData) => {
  return axios.patch<void>(urlBuilder(UPDATE_SPACE_AVATAR, { spaceId }), updateSpaceAvatarRo);
};
