import z from 'zod';
import { FieldType } from '../models';

export enum SUPPORTEDTYPE {
  CSV = 'csv',
  EXCEL = 'excel',
}

export const analyzeRoSchema = z.object({
  attachmentUrl: z.string().url(),
  fileType: z.nativeEnum(SUPPORTEDTYPE),
});

export const analyzeColumnSchema = z.object({
  type: z.nativeEnum(FieldType),
  name: z.string(),
});

export const analyzeVoSchema = z.object({
  worksheets: z
    .object({
      name: z.string(),
      columns: analyzeColumnSchema.array(),
    })
    .array(),
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

export const importOptionSchema = z.object({
  useFirstRowAsHeader: z.boolean(),
  importData: z.boolean(),
});

export const importOptionRoSchema = z.object({
  worksheets: z
    .object({
      name: z.string(),
      columns: importColumnSchema.array(),
      options: importOptionSchema,
    })
    .array(),
  attachmentUrl: z.string().url(),
  fileType: z.nativeEnum(SUPPORTEDTYPE),
});

export type IImportColumn = z.infer<typeof importColumnSchema>;

export type IImportOptionRo = z.infer<typeof importOptionRoSchema>;

export type IImportOption = z.infer<typeof importOptionSchema>;
