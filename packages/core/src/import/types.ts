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

export const analyzeVoSchema = z.object({
  calculatedColumnHeaders: z.array(
    z.object({
      type: z.nativeEnum(FieldType),
      name: z.string(),
    })
  ),
});

export type IAnalyzeRo = z.infer<typeof analyzeRoSchema>;

export type IAnalyzeVo = z.infer<typeof analyzeVoSchema>;

export type IValidateTypes =
  | FieldType.Number
  | FieldType.Date
  | FieldType.LongText
  | FieldType.Checkbox;

export const importOptionRoSchema = z.object({
  columnInfo: z
    .object({
      type: z.nativeEnum(FieldType),
      name: z.string(),
      sourceColumnIndex: z.number(),
    })
    .array(),
  options: z.object({
    useFirstRowAsHeader: z.boolean(),
    importData: z.boolean(),
  }),
  attachmentUrl: z.string().url(),
  fileType: z.nativeEnum(SUPPORTEDTYPE),
});

export type IImportOptionRo = z.infer<typeof importOptionRoSchema>;
