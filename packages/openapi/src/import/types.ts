import { FieldType, timeZoneStringSchema } from '@teable/core';
import z from 'zod';

export enum SUPPORTEDTYPE {
  CSV = 'csv',
  EXCEL = 'excel',
}

export const analyzeRoSchema = z.object({
  attachmentUrl: z.string(),
  fileType: z.nativeEnum(SUPPORTEDTYPE),
});

export const analyzeColumnSchema = z.object({
  type: z.nativeEnum(FieldType),
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
  attachmentUrl: z.string(),
  fileType: z.nativeEnum(SUPPORTEDTYPE),
  notification: z.boolean().optional(),
  tz: timeZoneStringSchema,
});

export const inplaceImportOptionRoSchema = z.object({
  attachmentUrl: z.string(),
  fileType: z.nativeEnum(SUPPORTEDTYPE),
  insertConfig: z.object({
    sourceWorkSheetKey: z.string(),
    excludeFirstRow: z.boolean(),
    sourceColumnMap: z.record(z.number().nullable()),
  }),
  notification: z.boolean().optional(),
});

export type IImportColumn = z.infer<typeof importColumnSchema>;

export type IImportOptionRo = z.infer<typeof importOptionRoSchema>;

export type IImportSheetItem = z.infer<typeof importSheetItem>;

export type IImportOption = z.infer<typeof importOptionSchema>;

export type IInplaceImportOptionRo = z.infer<typeof inplaceImportOptionRoSchema>;
