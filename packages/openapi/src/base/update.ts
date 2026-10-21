import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { createBaseRoSchema } from './create';

export const UPDATE_BASE = '/base/{baseId}';

export const updateBaseRoSchema = createBaseRoSchema.omit({ spaceId: true }).extend({
  icon: createBaseRoSchema.shape.icon.nullable(),
});

export type IUpdateBaseRo = z.infer<typeof updateBaseRoSchema>;

export const updateBaseVoSchema = z.object({
  spaceId: z.string(),
  name: z.string(),
  icon: z.string().emoji().optional().nullable(),
});

export type IUpdateBaseVo = z.infer<typeof updateBaseVoSchema>;

export const UpdateBaseRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_BASE,
  title: 'Patch project',
  sidebarTitle: 'Update project',
  description: "Update a project's name or icon.",
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateBaseRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns information about a successfully updated project.',
      content: {
        'application/json': {
          schema: updateBaseVoSchema,
        },
      },
    },
  },
  tags: ['base'],
});

export const updateBase = async (params: { baseId: string; updateBaseRo: IUpdateBaseRo }) => {
  const { baseId, updateBaseRo } = params;
  return axios.patch<IUpdateBaseVo>(
    urlBuilder(UPDATE_BASE, {
      baseId,
    }),
    updateBaseRo
  );
};
