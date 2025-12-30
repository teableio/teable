import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { ICreateBaseVo } from './create';
import { createBaseVoSchema } from './create';

/**
 * Defines the mode of base duplication operation.
 * Different modes control how the base is duplicated and what transformations are applied.
 */
export enum BaseDuplicateMode {
  /**
   * Normal base duplication - all features are preserved as-is
   */
  Normal = 'normal',

  /**
   * Creating a template snapshot - automations and other dynamic features are disabled
   */
  CreateTemplate = 'createTemplate',

  /**
   * Applying a template - user emails in automations are replaced with the current user's email
   */
  ApplyTemplate = 'applyTemplate',
}

export const DUPLICATE_BASE = '/base/duplicate';

export const duplicateBaseRoSchema = z.object({
  fromBaseId: z.string().meta({
    description: 'The base to duplicate',
  }),
  spaceId: z.string().meta({
    description: 'The space to duplicate the base to',
  }),
  withRecords: z.boolean().optional().meta({
    description: 'Whether to duplicate the records',
  }),
  name: z.string().optional().meta({
    description: 'The name of the duplicated base',
  }),
  baseId: z.string().optional(),
  nodes: z.array(z.string()).optional().meta({
    description: 'The node IDs to include in the duplication',
  }),
});

export type IDuplicateBaseRo = z.infer<typeof duplicateBaseRoSchema>;

export const DuplicateBaseRoute: RouteConfig = registerRoute({
  method: 'post',
  path: DUPLICATE_BASE,
  description: 'duplicate a base',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: duplicateBaseRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns information about a successfully duplicated base.',
      content: {
        'application/json': {
          schema: createBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const duplicateBase = async (params: IDuplicateBaseRo) => {
  return axios.post<ICreateBaseVo>(DUPLICATE_BASE, params);
};
