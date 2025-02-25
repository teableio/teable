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

export const GET_PLUGIN = '/plugin/{pluginId}';

export const getPluginRoSchema = z.object({
  pluginId: z.string(),
});

export type IGetPluginRo = z.infer<typeof getPluginRoSchema>;

export const getPluginVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  detailDesc: z.string().optional(),
  logo: z.string(),
  url: z.string().optional(),
  helpUrl: z.string().optional(),
  positions: z.array(z.nativeEnum(PluginPosition)),
  i18n: pluginI18nSchema.optional(),
  config: pluginConfigSchema.optional(),
  secret: z.string(),
  status: z.nativeEnum(PluginStatus),
  pluginUser: pluginUserSchema,
  createdTime: z.string(),
  lastModifiedTime: z.string(),
});

export type IGetPluginVo = z.infer<typeof getPluginVoSchema>;

export const GetPluginRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PLUGIN,
  description: 'Get a plugin',
  request: {
    params: getPluginRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about the plugin.',
      content: {
        'application/json': {
          schema: getPluginVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const getPlugin = async (pluginId: string) => {
  return axios.get<IGetPluginVo>(urlBuilder(GET_PLUGIN, { pluginId }));
};
