import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { ViewType } from './constant';

export const shareViewMetaSchema = z.object({
  allowCopy: z.boolean().optional(),
  includeHiddenField: z.boolean().optional(),
  password: z.string().optional(),
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
  });

export type IViewRo = z.infer<typeof viewRoSchema>;
