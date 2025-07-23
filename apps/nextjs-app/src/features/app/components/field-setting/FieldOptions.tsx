import type {
  IFieldVo,
  IDateFieldOptions,
  IFormulaFieldOptions,
  ILinkFieldOptionsRo,
  INumberFieldOptions,
  ISelectFieldOptions,
  IRollupFieldOptions,
  IRatingFieldOptions,
  ISingleLineTextFieldOptions,
  ICreatedTimeFieldOptions,
  ILastModifiedTimeFieldOptions,
  IUserFieldOptions,
  ICheckboxFieldOptions,
  ILongTextFieldOptions,
  IButtonFieldOptions,
} from '@teable/core';
import { FieldType } from '@teable/core';
import { ButtonOptions } from './options/ButtonOptions';
import { CheckboxOptions } from './options/CheckboxOptions';
import { CreatedTimeOptions } from './options/CreatedTimeOptions';
import { DateOptions } from './options/DateOptions';
import { FormulaOptions } from './options/FormulaOptions';
import { LinkOptions } from './options/LinkOptions';
import { LongTextOptions } from './options/LongTextOptions';
import { NumberOptions } from './options/NumberOptions';
import { RatingOptions } from './options/RatingOptions';
import { RollupOptions } from './options/RollupOptions';
import { SelectOptions } from './options/SelectOptions/SelectOptions';
import { SingleLineTextOptions } from './options/SingleLineTextOptions';
import { UserOptions } from './options/UserOptions';
import type { IFieldEditorRo } from './type';

export interface IFieldOptionsProps {
  field: IFieldEditorRo;
  onChange: (options: Partial<IFieldVo['options']>) => void;
  onSave?: () => void;
}

export const FieldOptions: React.FC<IFieldOptionsProps> = ({ field, onChange, onSave }) => {
  const { id, type, isLookup, cellValueType, isMultipleCellValue, options } = field;
  switch (type) {
    case FieldType.SingleLineText:
      return (
        <SingleLineTextOptions
          isLookup={isLookup}
          options={options as ISingleLineTextFieldOptions}
          onChange={onChange}
        />
      );
    case FieldType.LongText:
      return (
        <LongTextOptions
          options={options as ILongTextFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect:
      return (
        <SelectOptions
          isMultiple={type === FieldType.MultipleSelect}
          options={options as ISelectFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Number:
      return (
        <NumberOptions
          options={options as INumberFieldOptions}
          isLookup={isLookup}
          isMultipleCellValue={isMultipleCellValue}
          onChange={onChange}
        />
      );
    case FieldType.Link:
      return (
        <LinkOptions
          fieldId={id}
          options={options as ILinkFieldOptionsRo}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Formula:
      return (
        <FormulaOptions
          options={options as IFormulaFieldOptions}
          isLookup={isLookup}
          cellValueType={cellValueType}
          isMultipleCellValue={isMultipleCellValue}
          onChange={onChange}
        />
      );
    case FieldType.User:
      return (
        <UserOptions
          options={options as IUserFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Date:
      return (
        <DateOptions
          options={options as IDateFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.CreatedTime:
      return (
        <CreatedTimeOptions options={options as ICreatedTimeFieldOptions} onChange={onChange} />
      );
    case FieldType.LastModifiedTime:
      return (
        <CreatedTimeOptions
          options={options as ILastModifiedTimeFieldOptions}
          onChange={onChange}
        />
      );
    case FieldType.Rating:
      return (
        <RatingOptions
          options={options as IRatingFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Checkbox:
      return (
        <CheckboxOptions
          options={options as ICheckboxFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
        />
      );
    case FieldType.Rollup:
      return (
        <RollupOptions
          options={options as IRollupFieldOptions}
          isLookup={isLookup}
          cellValueType={cellValueType}
          isMultipleCellValue={isMultipleCellValue}
          onChange={onChange}
        />
      );
    case FieldType.Button:
      return (
        <ButtonOptions
          options={options as IButtonFieldOptions}
          isLookup={isLookup}
          onChange={onChange}
          onSave={onSave}
        />
      );
    default:
      return <></>;
  }
};
