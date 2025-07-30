import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const DELETE_USER = '/auth/user';

export const deleteUserErrorDataSchema = z.object({
  spaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      deletedTime: z.string().nullable(),
    })
  ),
});

export type IDeleteUserErrorData = z.infer<typeof deleteUserErrorDataSchema>;

export const deleteUserSchemaRo = z.object({
  confirm: z
    .string()
    .describe('Please enter DELETE to confirm')
    .refine((val) => val === 'DELETE', {
      message: 'Please enter DELETE to confirm',
    }),
});

export type IDeleteUserSchema = z.infer<typeof deleteUserSchemaRo>;

export const deleteUserRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_USER,
  description: 'Delete user',
  responses: {
    200: {
      description: 'Successfully deleted user',
    },
    400: {
      description: 'User has deleted bases or spaces',
      content: {
        'application/json': {
          schema: deleteUserErrorDataSchema,
        },
      },
    },
  },
  request: {
    params: deleteUserSchemaRo,
  },
  tags: ['auth'],
});

export const deleteUser = async (confirm: string) => {
  return axios.delete(DELETE_USER, {
    params: {
      confirm,
    },
  });
};
