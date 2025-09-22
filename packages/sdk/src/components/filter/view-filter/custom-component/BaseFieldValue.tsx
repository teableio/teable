import type { IDateFilter, IFilterItem } from '@teable/core';
import { assertNever, CellValueType, FieldType } from '@teable/core';
import { useMemo } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import type { DateField, IFieldInstance } from '../../../../model';
import { NumberEditor, RatingEditor } from '../../../editor';
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
import type { ILinkContext } from '../component/filter-link/context';
import { EMPTY_OPERATORS, ARRAY_OPERATORS } from '../constant';
import type { IFilterComponents } from '../types';

interface IBaseFieldValue {
  value: unknown;
  operator: IFilterItem['operator'];
  onSelect: (value: IFilterItem['value']) => void;
  field?: IFieldInstance;
  components?: IFilterComponents;
  linkContext?: ILinkContext;
  modal?: boolean;
}

export function BaseFieldValue(props: IBaseFieldValue) {
  const { onSelect, components, field, operator, value, linkContext, modal } = props;
  const { t } = useTranslation();

  const showEmptyComponent = useMemo(() => {
    const showEmpty = EMPTY_OPERATORS.includes(operator);
    showEmpty && onSelect?.(null);
    return showEmpty;
  }, [operator, onSelect]);

  if (showEmptyComponent) {
    return null;
  }

  const InputComponent = (
    <FilterInput
      placeholder={t('filter.default.placeholder')}
      value={value as string}
      onChange={onSelect}
      className="min-w-28 max-w-40"
    />
  );

  const getFormulaValueComponent = (cType: CellValueType) => {
    switch (cType) {
      case CellValueType.Boolean:
        return <FilterCheckbox value={value as boolean} onChange={onSelect} className="w-10" />;
      case CellValueType.DateTime:
        return (
          <FilterDatePicker
            field={field as unknown as DateField}
            value={value as IDateFilter}
            onSelect={onSelect}
            operator={operator}
          />
        );
      case CellValueType.Number:
        return (
          <NumberEditor
            value={value as number}
            saveOnChange={true}
            onChange={onSelect as (value?: number | null) => void}
            className="min-w-28 max-w-40 placeholder:text-xs"
            placeholder={t('filter.default.placeholder')}
          />
        );
      case CellValueType.String:
        return InputComponent;
      default:
        assertNever(cType);
    }
  };

  switch (field?.type) {
    case FieldType.Number:
      return (
        <NumberEditor
          value={value as number}
          saveOnChange={true}
          onChange={onSelect as (value?: number | null) => void}
          className="min-w-28 max-w-40 placeholder:text-xs"
          placeholder={t('filter.default.placeholder')}
        />
      );
    case FieldType.SingleSelect:
      return ARRAY_OPERATORS.includes(operator) ? (
        <FilterMultipleSelect
          field={field}
          modal={modal}
          value={value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
          className="min-w-28 max-w-64"
          popoverClassName="max-w-64 min-w-28"
        />
      ) : (
        <FilterSingleSelect
          field={field}
          modal={modal}
          value={value as string}
          onSelect={onSelect}
          operator={operator}
          className="min-w-28 max-w-64"
          popoverClassName="max-w-64 min-w-28"
        />
      );
    case FieldType.MultipleSelect:
      return (
        <FilterMultipleSelect
          field={field}
          modal={modal}
          value={value as string[]}
          onSelect={(value) => onSelect(value as IFilterItem['value'])}
          className="min-w-28 max-w-64"
          popoverClassName="min-w-28 max-w-64"
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
          modal={modal}
        />
      );
    case FieldType.Checkbox:
      return <FilterCheckbox value={value as boolean} onChange={onSelect} className="w-10" />;
    case FieldType.Link: {
      const linkProps = {
        field,
        onSelect: (value: string[] | string | null) =>
          onSelect(value?.length ? (value as IFilterItem['value']) : null),
        value: value as string[],
        operator: operator,
        context: linkContext,
      };
      if (components && components[FieldType.Link]) {
        const LinkComponents = components[FieldType.Link];
        return <LinkComponents {...linkProps} />;
      }
      return <FilterLink {...linkProps} modal={modal} />;
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
    case FieldType.User:
    case FieldType.CreatedBy:
    case FieldType.LastModifiedBy: {
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
      return <FilterUserSelect {...props} modal={modal} />;
    }
    case FieldType.Rollup:
    case FieldType.Formula:
    case FieldType.ReferenceLookup: {
      return getFormulaValueComponent(field.cellValueType);
    }
    default:
      return InputComponent;
  }
}
