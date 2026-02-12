import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseShareVoSchema, updateBaseShareRoSchema } from './types';

export const UPDATE_BASE_SHARE = '/base/{baseId}/share/{shareId}';

export const UpdateBaseShareRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_BASE_SHARE,
  description: 'Update a base share link',
  request: {
    params: z.object({
      baseId: z.string(),
      shareId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseShareRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns the updated base share',
      content: {
        'application/json': {
          schema: baseShareVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const updateBaseShare = (
  baseId: string,
  shareId: string,
  data: z.infer<typeof updateBaseShareRoSchema>
) => {
  return axios.patch<z.infer<typeof baseShareVoSchema>>(
    urlBuilder(UPDATE_BASE_SHARE, { baseId, shareId }),
    data
  );
};
