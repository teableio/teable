import { FieldType, timeZoneStringSchema } from '@teable/core';
import { z } from 'zod';
import { READ_PATH } from '../attachment/utils';

export enum SUPPORTEDTYPE {
  CSV = 'csv',
  EXCEL = 'excel',
}

/**
 * An import source URL must be either an absolute http(s) URL or the server's
 * own attachment-read path (resolved against the server origin downstream).
 *
 * This blocks two SSRF vectors at the API boundary: non-http protocols
 * (file://, gopher://, …) and arbitrary relative paths that would be fetched
 * from the loopback interface (e.g. "/admin" → http://localhost/admin). The
 * socket-level SSRF guard in the import fetch additionally blocks absolute URLs
 * that resolve to internal/private addresses.
 */
export const attachmentUrlSchema = z.string().refine(
  (value) => {
    const trimmed = value.trim();
    try {
      const { protocol } = new URL(trimmed);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return trimmed.startsWith(`${READ_PATH}/`);
    }
  },
  { message: 'attachmentUrl must be an http(s) URL or an attachment read path' }
);

export const analyzeRoSchema = z.object({
  attachmentUrl: attachmentUrlSchema,
  fileType: z.enum(SUPPORTEDTYPE),
});

export const analyzeColumnSchema = z.object({
  type: z.enum(FieldType),
  name: z.string(),
});

export const analyzeVoSchema = z.object({
  worksheets: z.record(
    z.string(),
    z.object({
      name: z.string(),
      columns: analyzeColumnSchema.array(),
    })
  ),
});

export type IAnalyzeRo = z.infer<typeof analyzeRoSchema>;

export type IAnalyzeVo = z.infer<typeof analyzeVoSchema>;

export type IAnalyzeColumn = z.infer<typeof analyzeColumnSchema>;

export type IValidateTypes =
  | FieldType.Number
  | FieldType.Date
  | FieldType.LongText
  | FieldType.Checkbox
  | FieldType.SingleLineText;

export const importColumnSchema = analyzeColumnSchema.extend({
  sourceColumnIndex: z.number(),
});

export const importSheetItem = z.object({
  name: z.string(),
  columns: importColumnSchema.array(),
  useFirstRowAsHeader: z.boolean(),
  importData: z.boolean(),
});

export const importOptionSchema = importSheetItem.pick({
  useFirstRowAsHeader: true,
  importData: true,
});

export const importOptionRoSchema = z.object({
  worksheets: z.record(z.string(), importSheetItem),
  attachmentUrl: attachmentUrlSchema,
  fileType: z.enum(SUPPORTEDTYPE),
  notification: z.boolean().optional(),
  tz: timeZoneStringSchema,
});

export const inplaceImportOptionRoSchema = z.object({
  attachmentUrl: attachmentUrlSchema,
  fileType: z.enum(SUPPORTEDTYPE),
  insertConfig: z.object({
    sourceWorkSheetKey: z.string(),
    excludeFirstRow: z.boolean(),
    sourceColumnMap: z.record(z.string(), z.number().nullable()),
  }),
  notification: z.boolean().optional(),
});

export type IImportColumn = z.infer<typeof importColumnSchema>;

export type IImportOptionRo = z.infer<typeof importOptionRoSchema>;

export type IImportSheetItem = z.infer<typeof importSheetItem>;

export type IImportOption = z.infer<typeof importOptionSchema>;

export type IInplaceImportOptionRo = z.infer<typeof inplaceImportOptionRoSchema>;
