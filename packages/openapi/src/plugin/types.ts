import { LOCALES } from '@teable/core';
import { z } from '../zod';

export type IPlugin18nJsonType = {
  [key: string]: string | IPlugin18nJsonType;
};

export const pluginI18nJsonSchema: z.ZodType<IPlugin18nJsonType> = z.lazy(() =>
  z.record(z.string(), z.union([z.string(), pluginI18nJsonSchema]))
);

export const pluginI18nSchema = z.record(z.enum(LOCALES), pluginI18nJsonSchema).openapi({
  type: 'object',
  example: {
    en: {
      title: 'Plugin title',
      description: 'Plugin description',
    },
    zh: {
      title: '插件标题',
      description: '插件描述',
    },
  },
});

export type IPluginI18n = z.infer<typeof pluginI18nSchema>;

export enum PluginPosition {
  Dashboard = 'dashboard',
  View = 'view',
  ContextMenu = 'contextMenu',
  Panel = 'panel',
}

export enum PluginStatus {
  Developing = 'developing',
  Reviewing = 'reviewing',
  Published = 'published',
}

export const pluginUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    avatar: z.string().optional(),
  })
  .optional();

export const pluginCreatedBySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(),
});

export const pluginConfigSchema = z
  .object({
    [PluginPosition.ContextMenu]: z
      .object({
        width: z.number().or(z.string()),
        height: z.number().or(z.string()),
        x: z.number().or(z.string()),
        y: z.number().or(z.string()),
        frozenResize: z.boolean().optional(),
        frozenDrag: z.boolean().optional(),
      })
      .partial(),
    [PluginPosition.View]: z.null(),
    [PluginPosition.Dashboard]: z.null(),
    [PluginPosition.Panel]: z.null(),
  })
  .partial()
  .superRefine((data, ctx) => {
    const keys = Object.keys(data);
    const res = z.array(z.nativeEnum(PluginPosition)).safeParse(keys);
    if (!res.success) {
      res.error.issues.forEach((issue) => {
        ctx.addIssue(issue);
      });
    }
  });
export type IPluginConfig = z.infer<typeof pluginConfigSchema>;
