import type { IDateFilter, IFilterItem } from '@teable/core';
import { FieldType } from '@teable/core';

import { Input } from '@teable/ui-lib';
import { useContext, useMemo } from 'react';

import type { DateField } from '../../../model';
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
import { FilterContext } from '../context';

interface IFieldValue {
  filter: IFilterItem;
  onSelect: (value: IFilterItem['value']) => void;
}

function FieldValue(props: IFieldValue) {
  const { filter, onSelect } = props;
  const { components, fields } = useContext(FilterContext);
  const field = fields.find((f) => f.id === filter.fieldId);

  const emptyComponent = <Input className="m-1 h-8 w-40 placeholder:text-[13px]" disabled />;
  const showEmptyComponent = useMemo(() => {
    const showEmpty = EMPTY_OPERATORS.includes(filter.operator);
    showEmpty && onSelect?.(null);
    return showEmpty;
  }, [filter.operator, onSelect]);

  if (showEmptyComponent) {
    return emptyComponent;
  }

  const InputComponent = (
    <FilterInput
      placeholder="Enter a value"
      value={filter.value as string}
      onChange={onSelect}
      className="w-40"
    />
  );

  switch (field?.type) {
    case FieldType.Number:
      return (
        <NumberEditor
          value={filter.value as number}
          options={field.options}
          onChange={onSelect as (value?: number | null) => void}
          className="m-1 w-40"
        />
      );
    case FieldType.SingleSelect:
      return MULTIPLE_OPERATORS.includes(filter.operator) ? (
        <FilterMultipleSelect
          field={field}
          value={filter.value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
        />
      ) : (
        <FilterSingleSelect
          field={field}
          value={filter.value as string}
          onSelect={onSelect}
          operator={filter.operator}
        />
      );
    case FieldType.MultipleSelect:
      return (
        <FilterMultipleSelect
          field={field}
          value={filter.value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
        />
      );
    case FieldType.Date:
    case FieldType.CreatedTime:
    case FieldType.LastModifiedTime:
      return (
        <FilterDatePicker
          field={field as DateField}
          value={filter.value as IDateFilter}
          onSelect={onSelect}
          operator={filter.operator}
        />
      );
    case FieldType.Checkbox:
      return <FilterCheckbox value={filter.value as boolean} onChange={onSelect} />;
    case FieldType.Link: {
      const linkProps = {
        field,
        onSelect: (value: string[] | string | null) =>
          onSelect(value?.length ? (value as IFilterItem['value']) : null),
        value: filter.value as string[],
        operator: filter.operator,
      };
      if (components && components[FieldType.Link]) {
        const LinkComponents = components[FieldType.Link];
        return <LinkComponents {...linkProps} />;
      }
      return <FilterLink {...linkProps} />;
    }
    case FieldType.Attachment:
      return <FileTypeSelect value={filter.value as string} onSelect={onSelect} />;
    case FieldType.Rating:
      return (
        <RatingEditor
          value={filter.value as number}
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
        value: filter.value as string[],
        operator: filter.operator,
      };
      if (components && components[FieldType.User]) {
        const UserComponents = components[FieldType.User];
        return <UserComponents {...props} />;
      }
      return <FilterUserSelect {...props} />;
    }
    default:
      return InputComponent;
  }
}

export { FieldValue };
