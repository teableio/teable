import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const DELETE_USER = '/auth/user';

// A live space the user is the only owner of. It is moved to trash together
// with the account once the user acknowledges it via `spaceIds`, unless the
// user hands it over to another member first (only possible when other
// members remain). A subscribed space needs its subscription cancelled first.
export const deleteUserBlockingSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  hasOtherMembers: z.boolean(),
  subscribed: z.boolean().optional(),
});

export type IDeleteUserBlockingSpace = z.infer<typeof deleteUserBlockingSpaceSchema>;

export const deleteUserErrorDataSchema = z.object({
  spaces: z.array(deleteUserBlockingSpaceSchema),
});

export type IDeleteUserErrorData = z.infer<typeof deleteUserErrorDataSchema>;

export const DELETE_USER_SPACES = '/auth/user/sole-owner-spaces';

// What leaves with the account: the same list the refusal carries, readable before the
// first press so the page can show it up front instead of discovering it by failing.
export const deleteUserSpacesVoSchema = deleteUserErrorDataSchema;

export type IDeleteUserSpacesVo = z.infer<typeof deleteUserSpacesVoSchema>;

export const getDeleteUserSpacesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: DELETE_USER_SPACES,
  description: 'The spaces the user is the only owner of, which go to trash with the account',
  responses: {
    200: {
      description: 'Spaces to settle before, or trash with, the account',
      content: {
        'application/json': {
          schema: deleteUserSpacesVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const getDeleteUserSpaces = async () => {
  return axios.get<IDeleteUserSpacesVo>(DELETE_USER_SPACES);
};

export const deleteUserSchemaRo = z.object({
  confirm: z
    .string()
    .describe('Please enter DELETE to confirm')
    .refine((val) => val === 'DELETE', {
      message: 'Please enter DELETE to confirm',
    })
    .meta({ type: 'string' }),
  // sole-owner spaces the user agreed to move to trash together with the account
  spaceIds: z.array(z.string()).optional(),
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
      description:
        'User still owns spaces that must be acknowledged or handed over before the account can go',
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

export const deleteUser = async (confirm: string, spaceIds?: string[]) => {
  return axios.delete(DELETE_USER, {
    params: {
      confirm,
      spaceIds,
    },
  });
};
