import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const AUTHORIZED_LIST = '/oauth/client/authorized/list';

export const authorizedVoSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  homepage: z.string().url(),
  logo: z.string().url().optional(),
  description: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  lastUsedTime: z.string().optional(),
  createdUser: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
});

export type AuthorizedVo = z.infer<typeof authorizedVoSchema>;

export const authorizedListRoute = registerRoute({
  method: 'get',
  path: AUTHORIZED_LIST,
  description: 'Get the list of authorized applications',
  responses: {
    200: {
      description: 'Returns the list of authorized applications',
      content: {
        'application/json': {
          schema: z.array(authorizedVoSchema),
        },
      },
    },
  },
  tags: ['oauth'],
});

export const getAuthorizedList = async () => {
  return axios.get<AuthorizedVo[]>(AUTHORIZED_LIST);
};
