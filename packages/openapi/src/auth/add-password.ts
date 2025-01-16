import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { signupPasswordSchema } from './types';

export const ADD_PASSWORD = '/auth/add-password';

export const addPasswordRoSchema = z.object({
  password: signupPasswordSchema,
});

export type IAddPasswordRo = z.infer<typeof addPasswordRoSchema>;

export const addPasswordRoute = registerRoute({
  method: 'post',
  path: ADD_PASSWORD,
  description: 'Add password',
  request: {
    body: {
      content: {
        'application/json': {
          schema: addPasswordRoSchema,
        },
      },
    },
  },
  tags: ['auth'],
  responses: {
    201: {
      description: 'Successfully added password',
    },
  },
});

export const addPassword = async (ro: IAddPasswordRo) => {
  return axios.post<void>(ADD_PASSWORD, ro);
};
