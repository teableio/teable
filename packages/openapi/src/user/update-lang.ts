import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_LANG = '/user/lang';

export const updateUserLangRoSchema = z.object({
  lang: z.string(),
});

export type IUpdateUserLangRo = z.infer<typeof updateUserLangRoSchema>;

export const UpdateUserLangRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_LANG,
  description: 'Update user language',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateUserLangRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['user'],
});

export const updateUserLang = async (updateUserLangRo: IUpdateUserLangRo) => {
  return axios.patch<void>(UPDATE_USER_LANG, updateUserLangRo);
};
