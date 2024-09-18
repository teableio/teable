import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { pluginI18nSchema, PluginPosition, PluginStatus, pluginUserSchema } from './types';

export const GET_PLUGINS = '/plugin';

export const getPluginsVoSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    detailDesc: z.string().optional(),
    logo: z.string(),
    url: z.string().optional(),
    helpUrl: z.string().optional(),
    positions: z.array(z.nativeEnum(PluginPosition)),
    i18n: pluginI18nSchema,
    status: z.nativeEnum(PluginStatus),
    pluginUser: pluginUserSchema,
    createdTime: z.string(),
    lastModifiedTime: z.string(),
  })
);

export type IGetPluginsVo = z.infer<typeof getPluginsVoSchema>;

export const GetPluginsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_PLUGINS,
  description: 'Get plugins',
  responses: {
    200: {
      description: 'Returns data about the plugins.',
      content: {
        'application/json': {
          schema: getPluginsVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const getPlugins = async () => {
  return axios.get<IGetPluginsVo>(GET_PLUGINS);
};
