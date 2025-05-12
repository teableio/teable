import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { PluginPosition, PluginStatus, pluginCreatedBySchema, pluginI18nSchema } from './types';

export const PLUGIN_CENTER_GET_LIST = '/plugin/center/list';

export const getPluginCenterListRoSchema = z.object({
  ids: z.array(z.string()).optional(),
  positions: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }
      const parsingResult = z
        .array(z.nativeEnum(PluginPosition))
        .min(1)
        .safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return Array.from(new Set(parsingResult.data));
    }),
});

export type IGetPluginCenterListRo = z.infer<typeof getPluginCenterListRoSchema>;

export const getPluginCenterListVoSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    detailDesc: z.string().optional(),
    logo: z.string(),
    helpUrl: z.string().optional(),
    i18n: pluginI18nSchema.optional(),
    url: z.string().optional(),
    status: z.nativeEnum(PluginStatus),
    createdTime: z.string(),
    lastModifiedTime: z.string().optional(),
    createdBy: pluginCreatedBySchema,
  })
);

export type IGetPluginCenterListVo = z.infer<typeof getPluginCenterListVoSchema>;

export const GetPluginCenterListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLUGIN_CENTER_GET_LIST,
  description: 'Get a list of plugins center',
  request: {
    query: getPluginCenterListRoSchema,
  },
  responses: {
    200: {
      description: 'Returns data about the plugin center list.',
      content: {
        'application/json': {
          schema: getPluginCenterListVoSchema,
        },
      },
    },
  },
  tags: ['plugin'],
});

export const getPluginCenterList = async (positions?: PluginPosition[], ids?: string[]) => {
  return axios.get<IGetPluginCenterListVo>(PLUGIN_CENTER_GET_LIST, {
    params: {
      positions: JSON.stringify(positions),
      ids,
    },
  });
};
