import type { ViewQueryResultView } from '@teable/v2-core';
import { z } from 'zod';

const viewColumnMetaEntryDtoSchema = z.looseObject({
  order: z.number().nullable().optional(),
  visible: z.boolean().optional(),
  hidden: z.boolean().optional(),
  width: z.number().optional(),
  required: z.boolean().optional(),
  statisticFunc: z.string().nullable().optional(),
});

const viewShareMetaDtoSchema = z.object({
  allowCopy: z.boolean().optional(),
  includeHiddenField: z.boolean().optional(),
  password: z.string().optional(),
  includeRecords: z.boolean().optional(),
  submit: z.object({ requireLogin: z.boolean().optional() }).optional(),
  allowEdit: z.boolean().optional(),
});

const viewOrderItemDtoSchema = z.object({
  fieldId: z.string(),
  order: z.enum(['asc', 'desc']),
});

export const viewReadDtoSchema: z.ZodType<ViewQueryResultView> = z.object({
  id: z.string(),
  version: z.number().int().nonnegative().optional(),
  name: z.string(),
  type: z.enum(['grid', 'kanban', 'gallery', 'calendar', 'form', 'plugin']),
  description: z.string().optional(),
  order: z.number().optional(),
  options: z.unknown().optional(),
  filter: z.unknown().optional(),
  sort: z
    .object({
      sortObjs: z.array(viewOrderItemDtoSchema),
      manualSort: z.boolean().optional(),
    })
    .optional(),
  group: z.array(viewOrderItemDtoSchema).optional(),
  isLocked: z.boolean().optional(),
  shareId: z.string().optional(),
  enableShare: z.boolean().optional(),
  shareMeta: viewShareMetaDtoSchema.optional(),
  createdBy: z.string(),
  lastModifiedBy: z.string().optional(),
  createdTime: z.string(),
  lastModifiedTime: z.string().optional(),
  columnMeta: z.record(z.string(), viewColumnMetaEntryDtoSchema),
});

export type IViewReadDto = ViewQueryResultView;
