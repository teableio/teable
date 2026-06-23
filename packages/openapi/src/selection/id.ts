import { IdPrefix, filterSchema, groupSchema } from '@teable/core';
import { contentQueryBaseSchema, orderBySchema } from '../record';
import { z } from '../zod';

export const selectionIdsSchema = z
  .object({
    recordIds: z.array(z.string().startsWith(IdPrefix.Record)).optional(),
    fieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
    excludedRecordIds: z.array(z.string().startsWith(IdPrefix.Record)).optional(),
    excludedFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
    allRecords: z.boolean().optional(),
    allFields: z.boolean().optional(),
  })
  .superRefine((selection, ctx) => {
    if (!selection.allRecords && selection.recordIds == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recordIds'],
        message: 'recordIds is required unless allRecords is true',
      });
    }
  });

export type ISelectionIds = z.infer<typeof selectionIdsSchema>;

export const selectionIdsRoSchema = contentQueryBaseSchema.extend({
  filter: filterSchema.optional(),
  orderBy: orderBySchema.optional(),
  groupBy: groupSchema.optional(),
  collapsedGroupIds: z.array(z.string()).optional(),
  projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().meta({
    description:
      'If you want to get only some fields, pass in this parameter, otherwise all visible fields will be obtained',
  }),
  selection: selectionIdsSchema,
});

export type ISelectionIdsRo = z.infer<typeof selectionIdsRoSchema>;
