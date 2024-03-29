import type { IDateFilter, IFilterItem } from '@teable/core';
import { FieldType } from '@teable/core';

import { Input } from '@teable/ui-lib';
import { useCallback, useMemo } from 'react';
import { useField } from '../../../hooks';

import type { DateField } from '../../../model';
import { NumberEditor, RatingEditor } from '../../editor';
import {
  FileTypeSelect,
  FilterCheckbox,
  FilterDatePicker,
  FilterInput,
  FilterLinkSelect,
  FilterMultipleSelect,
  FilterSingleSelect,
  FilterUserSelect,
} from '../component';
import { EMPTYOPERATORS, MULPTIPLEOPERATORS } from '../constant';

interface IFieldValue {
  filter: IFilterItem;
  onSelect: (value: IFilterItem['value']) => void;
}

function FieldValue(props: IFieldValue) {
  const { filter, onSelect } = props;
  const field = useField(filter.fieldId);

  const emptyComponent = <Input className="m-1 h-8 w-40 placeholder:text-[13px]" disabled />;
  const showEmptyComponent = useMemo(() => {
    const showEmpty = EMPTYOPERATORS.includes(filter.operator);
    showEmpty && onSelect?.(null);
    return showEmpty;
  }, [filter.operator, onSelect]);

  const dynamicComponent = useCallback(() => {
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
            className="w-40 m-1"
          />
        );
      case FieldType.SingleSelect:
        return MULPTIPLEOPERATORS.includes(filter.operator) ? (
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
      case FieldType.SingleLineText:
      case FieldType.AutoNumber:
        return InputComponent;
      case FieldType.Checkbox:
        return <FilterCheckbox value={filter.value as boolean} onChange={onSelect} />;
      case FieldType.Link:
        return (
          <FilterLinkSelect
            field={field}
            onSelect={(value) => onSelect(value as IFilterItem['value'])}
            value={filter.value as string[]}
            operator={filter.operator}
          />
        );
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
      case FieldType.User:
        return (
          <FilterUserSelect
            field={field}
            onSelect={(value) => onSelect(value as IFilterItem['value'])}
            value={filter.value as string[]}
            operator={filter.operator}
          />
        );
      default:
        return InputComponent;
    }
  }, [field, filter.operator, filter.value, onSelect]);
  return <>{showEmptyComponent ? emptyComponent : dynamicComponent()}</>;
}

export { FieldValue };
