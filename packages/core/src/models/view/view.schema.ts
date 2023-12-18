import { z } from 'zod';
import { sharePasswordSchema } from '../../share';
import { IdPrefix } from '../../utils';
import { columnMetaSchema } from './column-meta.schema';
import { ViewType } from './constant';

export const shareViewMetaSchema = z.object({
  allowCopy: z.boolean().optional(),
  includeHiddenField: z.boolean().optional(),
  password: sharePasswordSchema.optional(),
});

export type IShareViewMeta = z.infer<typeof shareViewMetaSchema>;

export const viewVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.View),
  name: z.string(),
  type: z.nativeEnum(ViewType),
  description: z.string().optional(),
  order: z.number(),
  options: z.unknown().optional(),
  sort: z.unknown().optional(),
  filter: z.unknown().optional(),
  group: z.unknown().optional(),
  shareId: z.string().optional(),
  enableShare: z.boolean().optional(),
  shareMeta: shareViewMetaSchema.optional(),
  createdBy: z.string(),
  lastModifiedBy: z.string(),
  createdTime: z.string(),
  lastModifiedTime: z.string(),
  columnMeta: columnMetaSchema.openapi({
    description: 'A mapping of view IDs to their corresponding column metadata.',
  }),
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
  });

export type IViewRo = z.infer<typeof viewRoSchema>;
