import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import {
  pluginConfigSchema,
  pluginI18nSchema,
  PluginPosition,
  PluginStatus,
  pluginUserSchema,
} from './types';

export const UPDATE_PLUGIN = '/plugin/{id}';

export const updatePluginRoSchema = z.object({
  name: z.string(),
  description: z.string().max(150).optional(),
  detailDesc: z.string().max(3000).optional(),
  url: z.string().url().optional(),
  config: pluginConfigSchema.optional(),
  logo: z.string().optional(),
  helpUrl: z.string().url().optional(),
  positions: z.array(z.nativeEnum(PluginPosition)).min(1),
  i18n: pluginI18nSchema.optional(),
});

export type IUpdatePluginRo = z.infer<typeof updatePluginRoSchema>;

export const updatePluginVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  detailDesc: z.string().optional(),
  logo: z.string(),
  config: pluginConfigSchema.optional(),
  url: z.string().optional(),
  helpUrl: z.string().optional(),
  positions: z.array(z.nativeEnum(PluginPosition)),
  i18n: pluginI18nSchema.optional(),
  secret: z.string(),
  status: z.nativeEnum(PluginStatus),
  pluginUser: pluginUserSchema,
  createdTime: z.string(),
  lastModifiedTime: z.string(),
});

export type IUpdatePluginVo = z.infer<typeof updatePluginVoSchema>;

export const updatePluginRoute: RouteConfig = registerRoute({
  method: 'put',
  path: UPDATE_PLUGIN,
  description: 'Update a plugin',
  request: {
    params: z.object({
      id: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updatePluginRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Returns data about the plugin.',
      content: {
        'application/json': {
          schema: updatePluginVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const updatePlugin = async (id: string, data: IUpdatePluginRo) => {
  return axios.put<IUpdatePluginVo>(urlBuilder(UPDATE_PLUGIN, { id }), data);
};
