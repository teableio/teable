import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import type { IGetBaseVo } from '../base';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const COPY_BASE_SHARE = '/share/{shareId}/base/copy';

export const copyBaseShareRoSchema = z.object({
  spaceId: z.string().meta({
    description: 'The target space ID to copy the base to',
  }),
  name: z.string().optional().meta({
    description: 'The name of the copied base',
  }),
  withRecords: z.boolean().optional().default(true).meta({
    description: 'Whether to copy records',
  }),
  baseId: z.string().optional().meta({
    description:
      'The target base ID to copy into. If provided, tables will be added to the existing base instead of creating a new one.',
  }),
});

export type ICopyBaseShareRo = z.infer<typeof copyBaseShareRoSchema>;

export const copyBaseShareVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
});

export type ICopyBaseShareVo = z.infer<typeof copyBaseShareVoSchema>;

export const copyBaseShareRoute: RouteConfig = registerRoute({
  method: 'post',
  path: COPY_BASE_SHARE,
  description: 'Copy a shared base to a target space',
  request: {
    params: z.object({
      shareId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: copyBaseShareRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns the copied base',
      content: {
        'application/json': {
          schema: copyBaseShareVoSchema,
        },
      },
    },
  },
  tags: ['base-share'],
});

export const copyBaseShare = async (shareId: string, copyBaseShareRo: ICopyBaseShareRo) => {
  return axios.post<IGetBaseVo>(urlBuilder(COPY_BASE_SHARE, { shareId }), copyBaseShareRo);
};
