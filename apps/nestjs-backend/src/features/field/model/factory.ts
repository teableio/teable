import { assertNever, CellValueType, FieldType, generateFieldId } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { DbFieldType } from '../constant';
import type { CreateFieldRo } from './create-field.ro';
import { NumberFieldDto } from './field-dto/number-field.dto';
import { SingleLineTextFieldDto } from './field-dto/single-line-text-field.dto';
import { SingleSelectFieldDto } from './field-dto/single-select-field.dto';

export function createFieldInstance(createFieldRo: CreateFieldRo & { id?: string }) {
  // generate Id first
  const fieldDto = createFieldRo.id ? createFieldRo : { ...createFieldRo, id: generateFieldId() };

  switch (createFieldRo.type) {
    case FieldType.SingleLineText:
      return plainToInstance(SingleLineTextFieldDto, {
        ...fieldDto,
        calculatedType: FieldType.SingleLineText,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
      } as SingleLineTextFieldDto);
    case FieldType.Number:
      return plainToInstance(NumberFieldDto, {
        ...fieldDto,
        calculatedType: FieldType.Number,
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
      } as NumberFieldDto);
    case FieldType.SingleSelect:
      return plainToInstance(SingleSelectFieldDto, {
        ...fieldDto,
        calculatedType: FieldType.SingleSelect,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
      } as SingleSelectFieldDto);
    case FieldType.Attachment:
    case FieldType.Button:
    case FieldType.CreatedBy:
    case FieldType.Email:
    case FieldType.LastModifiedBy:
    case FieldType.LongText:
    case FieldType.MultipleSelect:
    case FieldType.PhoneNumber:
    case FieldType.URL:
    case FieldType.User:
    case FieldType.AutoNumber:
    case FieldType.Count:
    case FieldType.CreatedTime:
    case FieldType.Date:
    case FieldType.Duration:
    case FieldType.LastModifiedTime:
    case FieldType.Rating:
    case FieldType.Currency:
    case FieldType.Percent:
    case FieldType.Checkbox:
    case FieldType.Formula:
    case FieldType.Rollup:
    case FieldType.MultipleLookupValues:
    case FieldType.MultipleRecordLinks:
      throw new Error('did not implement yet');
    default:
      assertNever(createFieldRo.type);
  }
}

export type IFieldInstance = ReturnType<typeof createFieldInstance>;
