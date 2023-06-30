import type {
  DateFieldOptions,
  FormulaFieldOptions,
  ILinkFieldOptionsRo,
  LinkFieldOptions,
  NumberFieldOptions,
  SelectFieldOptions,
} from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { DateOptions } from './DateOptions';
import { FormulaOptions } from './FormulaOptions';
import { LinkOptions } from './LinkOptions';
import { NumberOptions } from './NumberOptions';
import { SelectOptions } from './SelectOptions';

export interface IFieldOptionsProps {
  options: IFieldInstance['options'];
  type: FieldType;
  isLookup: boolean | undefined;
  updateFieldOptions: (options: IFieldInstance['options'] | ILinkFieldOptionsRo) => void;
}

export const FieldOptions: React.FC<IFieldOptionsProps> = ({
  options,
  type,
  isLookup,
  updateFieldOptions,
}) => {
  switch (type) {
    case FieldType.SingleSelect:
    case FieldType.MultipleSelect:
      return (
        <SelectOptions
          options={options as SelectFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Number:
      return (
        <NumberOptions
          options={options as NumberFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Link:
      return (
        <LinkOptions
          options={options as LinkFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Formula:
      return (
        <FormulaOptions
          options={options as FormulaFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    case FieldType.Date:
      return (
        <DateOptions
          options={options as DateFieldOptions}
          isLookup={isLookup}
          onChange={updateFieldOptions}
        />
      );
    default:
      return <></>;
  }
};
