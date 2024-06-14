import type { IDateFilter, IFilterItem } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';

import { Input } from '@teable/ui-lib';
import { useMemo } from 'react';

import type { DateField, IFieldInstance } from '../../../model';
import { NumberEditor, RatingEditor } from '../../editor';
import {
  FileTypeSelect,
  FilterCheckbox,
  FilterDatePicker,
  FilterInput,
  FilterLink,
  FilterMultipleSelect,
  FilterSingleSelect,
  FilterUserSelect,
} from '../component';
import { EMPTY_OPERATORS, MULTIPLE_OPERATORS } from '../constant';
import type { IFilterComponents } from '../types';

interface IBaseFieldValue {
  value: unknown;
  operator: IFilterItem['operator'];
  onSelect: (value: IFilterItem['value']) => void;
  field?: IFieldInstance;
  components?: IFilterComponents;
}

export function BaseFieldValue(props: IBaseFieldValue) {
  const { onSelect, components, field, operator, value } = props;

  const emptyComponent = <Input className="m-1 h-8 w-40 placeholder:text-[13px]" disabled />;
  const showEmptyComponent = useMemo(() => {
    const showEmpty = EMPTY_OPERATORS.includes(operator);
    showEmpty && onSelect?.(null);
    return showEmpty;
  }, [operator, onSelect]);

  if (showEmptyComponent) {
    return emptyComponent;
  }

  const InputComponent = (
    <FilterInput
      placeholder="Enter a value"
      value={value as string}
      onChange={onSelect}
      className="w-40"
    />
  );

  switch (field?.type) {
    case FieldType.Number:
      return (
        <NumberEditor
          value={value as number}
          options={field.options}
          onChange={onSelect as (value?: number | null) => void}
          className="m-1 w-40"
        />
      );
    case FieldType.SingleSelect:
      return MULTIPLE_OPERATORS.includes(operator) ? (
        <FilterMultipleSelect
          field={field}
          value={value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
        />
      ) : (
        <FilterSingleSelect
          field={field}
          value={value as string}
          onSelect={onSelect}
          operator={operator}
        />
      );
    case FieldType.MultipleSelect:
      return (
        <FilterMultipleSelect
          field={field}
          value={value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
        />
      );
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime:
      return (
        <FilterDatePicker
          field={field as DateField}
          value={value as IDateFilter}
          onSelect={onSelect}
          operator={operator}
        />
      );
    case FieldType.Checkbox:
      return <FilterCheckbox value={value as boolean} onChange={onSelect} />;
    case FieldType.Link: {
      const linkProps = {
        field,
        onSelect: (value: string[] | string | null) =>
          onSelect(value?.length ? (value as IFilterItem['value']) : null),
        value: value as string[],
        operator: operator,
      };
      if (components && components[FieldType.Link]) {
        const LinkComponents = components[FieldType.Link];
        return <LinkComponents {...linkProps} />;
      }
      return <FilterLink {...linkProps} />;
    }
    case FieldType.Attachment:
      return <FileTypeSelect value={value as string} onSelect={onSelect} />;
    case FieldType.Rating:
      return (
        <RatingEditor
          value={value as number}
          options={field.options}
          onChange={onSelect as (value?: number) => void}
          className="h-8 rounded-md border border-input px-2 shadow-sm"
          iconClassName="w-4 h-4 mr-1"
        />
      );
    case FieldType.User: {
      const props = {
        field,
        onSelect: (value: string[] | string | null) =>
          onSelect(value?.length ? (value as IFilterItem['value']) : null),
        value: value as string[],
        operator: operator,
      };
      if (components && components[FieldType.User]) {
        const UserComponents = components[FieldType.User];
        return <UserComponents {...props} />;
      }
      return <FilterUserSelect {...props} />;
    }
    case FieldType.Formula: {
      if (field.cellValueType === CellValueType.Boolean) {
        return <FilterCheckbox value={value as boolean} onChange={onSelect} />;
      }
      return InputComponent;
    }
    default:
      return InputComponent;
  }
}
