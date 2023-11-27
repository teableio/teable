import type {
  IDateFieldOptions,
  IFormulaFieldOptions,
  ILinkFieldOptionsRo,
  INumberFieldOptions,
  ISelectFieldOptions,
  CellValueType,
  IRollupFieldOptions,
  ILookupOptionsRo,
  IRatingFieldOptions,
  ISingleLineTextFieldOptions,
  ICreatedTimeFieldOptions,
  ILastModifiedTimeFieldOptions,
} from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { CreatedTimeOptions } from './options/CreatedTimeOptions';
import { DateOptions } from './options/DateOptions';
import { FormulaOptions } from './options/FormulaOptions';
import { LinkOptions } from './options/LinkOptions';
import { NumberOptions } from './options/NumberOptions';
import { RatingOptions } from './options/RatingOptions';
import { RollupOptions } from './options/RollupOptions';
import { SelectOptions } from './options/SelectOptions';
import { SingleLineTextOptions } from './options/SingleLineTextOptions';

export interface IFieldOptionsProps {
  options: IFieldInstance['options'];
  type: FieldType;
  isLookup: boolean | undefined;
  lookupField?: IFieldInstance;
  lookupOptions: ILookupOptionsRo | undefined;
  cellValueType?: CellValueType;
  updateFieldOptions: (options: Partial<IFieldInstance['options']>) => void;
}

export const FieldOptions: React.FC<IFieldOptionsProps> = ({
  options,
  type,
  isLookup,
  lookupField,
  lookupOptions,
  updateFieldOptions,
}) => {
  switch (type) {
    case FieldType.SingleLineText:
      return (
        <SingleLineTextOptions
          options={options as ISingleLineTextFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect:
      return (
        <SelectOptions
          options={options as ISelectFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Number:
      return (
        <NumberOptions
          options={options as INumberFieldOptions}
          isLookup={isLookup}
          lookupField={lookupField}
          lookupOptions={lookupOptions}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Link:
      return (
        <LinkOptions
          options={options as ILinkFieldOptionsRo}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Formula:
      return (
        <FormulaOptions
          options={options as IFormulaFieldOptions}
          isLookup={isLookup}
          lookupField={lookupField}
          lookupOptions={lookupOptions}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Date:
      return (
        <DateOptions
          options={options as IDateFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.CreatedTime:
      return (
        <CreatedTimeOptions
          options={options as ICreatedTimeFieldOptions}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.LastModifiedTime:
      return (
        <CreatedTimeOptions
          options={options as ILastModifiedTimeFieldOptions}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Rating:
      return (
        <RatingOptions
          options={options as IRatingFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Rollup:
      return (
        <RollupOptions
          options={options as IRollupFieldOptions}
          isLookup={isLookup}
          lookupField={lookupField}
          lookupOptions={lookupOptions}
          onChange={updateFieldOptions}
        />
      );
    default:
      return <></>;
  }
};
