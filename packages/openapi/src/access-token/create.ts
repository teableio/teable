import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const CREATE_ACCESS_TOKEN = '/access-token';

const isValidDateString = (dateString: string) => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

export const createAccessTokenRoSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  spaceIds: z.array(z.string()).min(1).nullable().optional(),
  baseIds: z.array(z.string()).min(1).nullable().optional(),
  hasFullAccess: z.boolean().optional(),
  expiredTime: z
    .string()
    .refine(isValidDateString, {
      message: 'expiredTime: Invalid Date ',
    })
    .openapi({ example: '2024-03-25' }),
});

export type CreateAccessTokenRo = z.infer<typeof createAccessTokenRoSchema>;

export const createAccessTokenVoSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(z.string()),
  spaceIds: z.array(z.string()).nullable().optional(),
  baseIds: z.array(z.string()).nullable().optional(),
  hasFullAccess: z.boolean().optional(),
  expiredTime: z.string(),
  token: z.string(),
  createdTime: z.string(),
  lastUsedTime: z.string(),
});

export type CreateAccessTokenVo = z.infer<typeof createAccessTokenVoSchema>;

export const createAccessRoute = registerRoute({
  method: 'post',
  path: CREATE_ACCESS_TOKEN,
  description: 'Create access token',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createAccessTokenRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns access token.',
      content: {
        'application/json': {
          schema: createAccessTokenVoSchema,
        },
      },
    },
  },
  tags: ['access-token'],
});

export const createAccessToken = async (body: CreateAccessTokenRo) => {
  return axios.post<CreateAccessTokenVo>(CREATE_ACCESS_TOKEN, body);
};
