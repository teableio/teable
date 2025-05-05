import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const MOVE_BASE = '/base/{baseId}/move';

export const moveBaseRoSchema = z.object({
  spaceId: z.string(),
});

export type IMoveBaseRo = z.infer<typeof moveBaseRoSchema>;

export const MoveBaseRoute: RouteConfig = registerRoute({
  method: 'put',
  path: MOVE_BASE,
  description: 'move a base to another space',
  summary: 'move a base to another space',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: moveBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'move to another space successfully',
    },
  },
  tags: ['base'],
});

export const moveBase = async (baseId: string, spaceId: string) => {
  return await axios.put<void>(
    urlBuilder(MOVE_BASE, {
      baseId,
    }),
    {
      spaceId,
    }
  );
};
