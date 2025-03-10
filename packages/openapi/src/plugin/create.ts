import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import {
  pluginConfigSchema,
  pluginI18nSchema,
  PluginPosition,
  PluginStatus,
  pluginUserSchema,
} from './types';

export const CREATE_PLUGIN = '/plugin';

export const createPluginRoSchema = z.object({
  name: z.string().min(1).max(20),
  description: z.string().max(150).optional(),
  detailDesc: z.string().max(3000).optional(),
  logo: z.string(),
  url: z.string().url().optional(),
  config: pluginConfigSchema.optional(),
  helpUrl: z.string().url().optional(),
  positions: z.array(z.nativeEnum(PluginPosition)).min(1),
  i18n: pluginI18nSchema.optional(),
  autoCreateMember: z.boolean().optional(),
});

export type ICreatePluginRo = z.infer<typeof createPluginRoSchema>;

export const createPluginVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  detailDesc: z.string().optional(),
  logo: z.string(),
  url: z.string().optional(),
  config: pluginConfigSchema.optional(),
  helpUrl: z.string().optional(),
  positions: z.array(z.nativeEnum(PluginPosition)),
  i18n: pluginI18nSchema.optional(),
  secret: z.string(),
  status: z.nativeEnum(PluginStatus),
  pluginUser: pluginUserSchema,
  createdTime: z.string(),
});

export type ICreatePluginVo = z.infer<typeof createPluginVoSchema>;

export const createPluginRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_PLUGIN,
  description: 'Create a plugin',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createPluginRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns data about the plugin.',
      content: {
        'application/json': {
          schema: createPluginVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const createPlugin = (data: ICreatePluginRo) => {
  return axios.post<ICreatePluginVo>(CREATE_PLUGIN, data);
};
