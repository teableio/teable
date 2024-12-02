import { z } from 'zod';
import { assertNever } from '../../asserts';
import { FieldType } from './constant';
import {
  attachmentCellValueSchema,
  autoNumberCellValueSchema,
  dataFieldCellValueSchema,
  getFormulaCellValueSchema,
  linkCellValueSchema,
  numberCellValueSchema,
  singleLineTextCelValueSchema,
  userCellValueSchema,
} from './derivate';
import type { IFieldVo } from './field.schema';

const validateWithSchema = (schema: z.ZodType, value: unknown) => {
  return z
    .union([z.array(schema).nonempty(), schema])
    .nullable()
    .safeParse(value);
};

export const validateCellValue = (field: IFieldVo, cellValue: unknown) => {
  const { type, cellValueType } = field;

  switch (type) {
    case FieldType.LongText:
    case FieldType.SingleLineText:
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect:
      return validateWithSchema(singleLineTextCelValueSchema, cellValue);
    case FieldType.Number:
      return validateWithSchema(numberCellValueSchema, cellValue);
    case FieldType.Rating:
    case FieldType.AutoNumber:
      return validateWithSchema(autoNumberCellValueSchema, cellValue);
    case FieldType.Attachment:
      return attachmentCellValueSchema.nonempty().nullable().safeParse(cellValue);
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime:
      return validateWithSchema(dataFieldCellValueSchema, cellValue);
    case FieldType.Checkbox:
      return validateWithSchema(z.literal(true), cellValue);
    case FieldType.Link:
      return validateWithSchema(linkCellValueSchema, cellValue);
    case FieldType.User:
    case FieldType.CreatedBy:
    case FieldType.LastModifiedBy:
      return validateWithSchema(userCellValueSchema, cellValue);
    case FieldType.Rollup:
    case FieldType.Formula: {
      const schema = getFormulaCellValueSchema(cellValueType);
      return validateWithSchema(schema, cellValue);
    }
    case FieldType.Button:
    case FieldType.Count:
    case FieldType.Duration:
      throw new Error('did not implement yet');
    default:
      assertNever(type);
  }
};

export const validateDateFieldValueLoose = (cellValue: unknown, isMultipleCellValue?: boolean) => {
  if (isMultipleCellValue) {
    return z.array(z.string()).nonempty().nullable().safeParse(cellValue);
  }
  return z.string().nullable().safeParse(cellValue);
};
