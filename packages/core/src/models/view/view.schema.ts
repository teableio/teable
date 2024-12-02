import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { columnMetaSchema } from './column-meta.schema';
import { ViewType } from './constant';
import {
  calendarViewOptionSchema,
  formViewOptionSchema,
  galleryViewOptionSchema,
  gridViewOptionSchema,
  kanbanViewOptionSchema,
  pluginViewOptionSchema,
} from './derivate';
import { filterSchema } from './filter';
import { groupSchema } from './group';
import { viewOptionsSchema } from './option.schema';
import { sortSchema } from './sort';

export const sharePasswordSchema = z.string().min(3);

export const shareViewMetaSchema = z.object({
  allowCopy: z.boolean().optional(),
  includeHiddenField: z.boolean().optional(),
  password: sharePasswordSchema.optional(),
  includeRecords: z.boolean().optional(),
  submit: z
    .object({
      allow: z.boolean().optional(),
      requireLogin: z.boolean().optional(),
    })
    .optional(),
});

export type IShareViewMeta = z.infer<typeof shareViewMetaSchema>;

export const viewVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.View),
  name: z.string(),
  type: z.nativeEnum(ViewType),
  description: z.string().optional(),
  order: z.number().optional(),
  options: viewOptionsSchema.optional(),
  sort: sortSchema.optional(),
  filter: filterSchema.optional(),
  group: groupSchema.optional(),
  shareId: z.string().optional(),
  enableShare: z.boolean().optional(),
  shareMeta: shareViewMetaSchema.optional(),
  createdBy: z.string(),
  lastModifiedBy: z.string().optional(),
  createdTime: z.string(),
  lastModifiedTime: z.string().optional(),
  columnMeta: columnMetaSchema.openapi({
    description: 'A mapping of view IDs to their corresponding column metadata.',
  }),
  pluginId: z.string().optional(),
});

export type IViewVo = z.infer<typeof viewVoSchema>;

export const viewRoSchema = viewVoSchema
  .omit({
    id: true,
    createdBy: true,
    lastModifiedBy: true,
    createdTime: true,
    lastModifiedTime: true,
  })
  .partial({
    name: true,
    order: true,
    columnMeta: true,
  })
  .superRefine((data, ctx) => {
    const { type } = data;
    const optionsSchemaMap = {
      [ViewType.Form]: formViewOptionSchema,
      [ViewType.Kanban]: kanbanViewOptionSchema,
      [ViewType.Gallery]: galleryViewOptionSchema,
      [ViewType.Calendar]: calendarViewOptionSchema,
      [ViewType.Grid]: gridViewOptionSchema,
      [ViewType.Plugin]: pluginViewOptionSchema,
    } as const;
    if (!(type in optionsSchemaMap)) {
      return ctx.addIssue({
        path: ['options'],
        code: z.ZodIssueCode.custom,
        message: `Unknown view type: ${type}`,
      });
    }
    const optionsSchema = optionsSchemaMap[type as keyof typeof optionsSchemaMap];
    const result =
      type === ViewType.Plugin
        ? optionsSchema.safeParse(data.options)
        : optionsSchema.optional().safeParse(data.options);
    if (!result.success) {
      const issue = result.error.issues[0];
      ctx.addIssue(
        issue
          ? { ...issue, path: ['options'] }
          : {
              path: ['options'],
              code: z.ZodIssueCode.custom,
              message: `${result.error.message}`,
            }
      );
    }
  });

export type IViewRo = z.infer<typeof viewRoSchema>;
export type IViewPropertyKeys = keyof IViewVo;
export const VIEW_JSON_KEYS = ['options', 'sort', 'filter', 'group', 'shareMeta', 'columnMeta'];
