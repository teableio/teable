import type { IDateFilter, IFilterItem } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import { cn, Input } from '@teable/ui-lib';
import { useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n';
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
import { useCompact } from '../hooks';
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
  const { t } = useTranslation();
  const compact = useCompact();

  const emptyComponent = (
    <Input
      className={cn('m-1 h-8 placeholder:text-[13px]', {
        'max-w-40': compact,
        'w-40': !compact,
      })}
      disabled
    />
  );

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
      placeholder={t('filter.default.placeholder')}
      value={value as string}
      onChange={onSelect}
      className={cn({
        'max-w-40 min-w-24': compact,
        'w-40': !compact,
      })}
    />
  );

  switch (field?.type) {
    case FieldType.Number:
      return (
        <NumberEditor
          value={value as number}
          onChange={onSelect as (value?: number | null) => void}
          className={cn('m-1', {
            'max-w-40 min-w-24': compact,
            'w-40': !compact,
          })}
          placeholder={t('filter.default.placeholder')}
        />
      );
    case FieldType.SingleSelect:
      return MULTIPLE_OPERATORS.includes(operator) ? (
        <FilterMultipleSelect
          field={field}
          value={value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
          className={cn({ 'max-w-64': compact, 'w-64': !compact })}
          popoverClassName={cn({ 'max-w-64': compact, 'w-64': !compact })}
        />
      ) : (
        <FilterSingleSelect
          field={field}
          value={value as string}
          onSelect={onSelect}
          operator={operator}
          className={cn({ 'max-w-64': compact, 'w-64': !compact })}
          popoverClassName={cn({ 'max-w-64': compact, 'w-64': !compact })}
        />
      );
    case FieldType.MultipleSelect:
      return (
        <FilterMultipleSelect
          field={field}
          value={value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
          className={cn({ 'max-w-64': compact, 'w-64': !compact })}
          popoverClassName={cn({ 'max-w-64': compact, 'w-64': !compact })}
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
      return (
        <FilterCheckbox
          value={value as boolean}
          onChange={onSelect}
          className={cn({
            'max-w-20 min-w-10': compact,
            'w-20': !compact,
          })}
        />
      );
    case FieldType.Link: {
      const linkProps = {
        field,
        onSelect: (value: string[] | string | null) =>
          onSelect(value?.length ? (value as IFilterItem['value']) : null),
        value: value as string[],
        operator: operator,
        className: 'ml-1',
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
          className="ml-1 h-8 rounded-md border border-input px-2 shadow-sm"
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
        return (
          <FilterCheckbox
            value={value as boolean}
            onChange={onSelect}
            className={cn({
              'max-w-20 min-w-10': compact,
              'w-20': !compact,
            })}
          />
        );
      }
      return InputComponent;
    }
    default:
      return InputComponent;
  }
}
