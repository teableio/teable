import {
  DbTableName,
  fieldTypeValues,
  recordFilterSchema,
  recordSearchInputSchema,
} from '@teable/v2-core';
import { z } from 'zod';

import { fieldDtoSchema, viewDtoSchema } from './table/dto';
import { tableRecordDtoSchema } from './table/recordDto';

const jsonInput = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema);

const fieldId = z.string().startsWith('fld');
const linkSelection = z.union([fieldId, z.tuple([fieldId, z.string().startsWith('rec')])]);
const querySchema = z.object({
  viewId: z.string().startsWith('viw').optional(),
  ignoreViewQuery: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === 'boolean' ? value : value.toLowerCase() !== 'false'))
    .optional(),
  filterByTql: z.string().optional(),
  filter: jsonInput(recordFilterSchema).optional(),
  search: recordSearchInputSchema.optional(),
  filterLinkCellCandidate: linkSelection.optional(),
  filterLinkCellSelected: linkSelection.optional(),
  selectedRecordIds: z.array(z.string().startsWith('rec')).optional(),
});

const statisticSchema = z.enum([
  'count',
  'empty',
  'filled',
  'unique',
  'max',
  'min',
  'sum',
  'average',
  'checked',
  'unChecked',
  'percentEmpty',
  'percentFilled',
  'percentUnique',
  'percentChecked',
  'percentUnChecked',
  'earliestDate',
  'latestDate',
  'dateRangeOfDays',
  'dateRangeOfMonths',
  'totalAttachmentSize',
]);
const statisticValueSchema = z.object({
  value: z.union([z.string(), z.number()]).nullable(),
  aggFunc: statisticSchema,
});
export const aggregateRecordsQuerySchema = querySchema.extend({
  groupBy: jsonInput(
    z.array(
      z.object({
        fieldId: z.string(),
        order: z.enum(['asc', 'desc']),
      })
    )
  ).optional(),
  field: z.partialRecord(statisticSchema, z.array(z.string())).optional(),
});
export const aggregateRecordsDataSchema = z.object({
  aggregations: z
    .array(
      z.object({
        fieldId,
        total: statisticValueSchema.nullable(),
        group: z.record(z.string(), statisticValueSchema).nullable().optional(),
      })
    )
    .optional(),
});
export const countRecordsQuerySchema = querySchema.extend({
  projection: z.array(fieldId).optional(),
});
export const countRecordsDataSchema = z.object({ rowCount: z.number() });

// Relative URLs may address only the host attachment reader, never arbitrary loopback paths.
const attachmentUrlSchema = z.string().refine((value) => {
  const trimmed = value.trim();
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return trimmed.startsWith('/api/attachments/read/');
  }
}, 'attachmentUrl must be an http(s) URL or an attachment read path');
const fileType = z.enum(['csv', 'excel']);
export const importFileOptionsSchema = z.object({
  worksheets: z.record(
    z.string(),
    z.object({
      name: z.string(),
      columns: z.array(
        z.object({
          type: z.enum(fieldTypeValues).exclude(['lookup', 'conditionalLookup']),
          name: z.string(),
          sourceColumnIndex: z.number(),
        })
      ),
      useFirstRowAsHeader: z.boolean(),
      importData: z.boolean(),
    })
  ),
  attachmentUrl: attachmentUrlSchema,
  fileType,
  notification: z.boolean().optional(),
  tz: z.string(),
  folderId: z.string().optional(),
});
export const inplaceImportFileOptionsSchema = z.object({
  attachmentUrl: attachmentUrlSchema,
  fileType,
  insertConfig: z.object({
    sourceWorkSheetKey: z.string(),
    excludeFirstRow: z.boolean(),
    sourceColumnMap: z.record(z.string(), z.number().nullable()),
  }),
  notification: z.boolean().optional(),
});
export const importStatusDataSchema = z.object({
  tableId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'not_found']),
  successCount: z.number().optional(),
  failedCount: z.number().optional(),
  message: z.string().optional(),
  errorReportUrl: z.string().optional(),
});
export const importSheetSummaryDtoSchema = z.object({
  name: z.string(),
  importedCount: z.number(),
  truncated: z.boolean(),
  error: z.string().optional(),
  localization: z
    .object({
      i18nKey: z.string(),
      context: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export const importedTableDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  dbTableName: z
    .string()
    .refine((name) => DbTableName.rehydrate(name).isOk(), 'Invalid DbTableName'),
  description: z.string().optional(),
  icon: z.string().optional(),
  defaultViewId: z.string().optional(),
  fields: z.array(fieldDtoSchema),
  views: z.array(viewDtoSchema.extend({ createdBy: z.string(), createdTime: z.string() })),
  records: z.array(tableRecordDtoSchema),
  order: z.number().optional(),
  lastModifiedTime: z.string().optional(),
});
