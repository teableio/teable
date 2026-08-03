import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { crossSpaceAffectedFieldBaseSchema } from './cross-space-affected-field';
import { moveBaseVoSchema, type IMoveBaseVo } from './move-data-db';

export const MOVE_BASE = '/base/{baseId}/move';

export const moveBaseRoSchema = z.object({
  spaceId: z.string(),
});

export type IMoveBaseRo = z.infer<typeof moveBaseRoSchema>;

export const crossSpaceAffectedFieldSchema = crossSpaceAffectedFieldBaseSchema.extend({
  tableId: z.string(),
  tableName: z.string(),
  baseId: z.string(),
  baseName: z.string(),
  reason: z.enum(['direct_link', 'incoming_link']),
});

export type ICrossSpaceAffectedField = z.infer<typeof crossSpaceAffectedFieldSchema>;

export const MoveBaseRoute: RouteConfig = registerRoute({
  method: 'put',
  path: MOVE_BASE,
  description:
    'Move a base to another space. Same data-DB moves complete synchronously. Cross-data-DB moves return a jobId and run asynchronously.',
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
      description: 'move completed or accepted as async job',
      content: {
        'application/json': {
          schema: moveBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const moveBase = async (baseId: string, spaceId: string) => {
  return await axios.put<IMoveBaseVo>(urlBuilder(MOVE_BASE, { baseId }), { spaceId });
};
