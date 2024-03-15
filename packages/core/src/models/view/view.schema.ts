import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { columnMetaSchema } from './column-meta.schema';
import { ViewType } from './constant';
import { filterSchema } from './filter';
import { groupSchema } from './group';
import { viewOptionsSchema } from './option.schema';
import { sortSchema } from './sort';

export const sharePasswordSchema = z.string().min(3);

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
    columnMeta: true,
  });

export type IViewRo = z.infer<typeof viewRoSchema>;
export type IViewPropertyKeys = keyof IViewRo;
export const VIEW_JSON_KEYS = ['options', 'sort', 'filter', 'group', 'shareMeta', 'columnMeta'];
