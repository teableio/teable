import {
  assertNever,
  CellValueType,
  FieldType,
  is,
  isNot,
  isFieldReferenceValue,
} from '@teable/core';
import type { IDateFilter, IFilterItem, IFieldReferenceValue } from '@teable/core';
import { RefreshCcw } from '@teable/icons';
import { Button } from '@teable/ui-lib';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import type { DateField, IFieldInstance } from '../../../../model';
import { NumberEditor, RatingEditor } from '../../../editor';
import { FieldSelector } from '../../../field';
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
  selfFields?: IFieldInstance[];
  selfTableId?: string;
  enableFieldReference?: boolean;
}

const FIELD_REFERENCE_SUPPORTED_OPERATORS = new Set<string>([is.value, isNot.value]);

interface IReferenceLookupValueProps {
  literalComponent: JSX.Element;
  value: unknown;
  onSelect: (value: IFilterItem['value']) => void;
  operator: IFilterItem['operator'];
  selfFields?: IFieldInstance[];
  selfTableId?: string;
  modal?: boolean;
}

const ReferenceLookupValue = (props: IReferenceLookupValueProps) => {
  const { literalComponent, value, onSelect, operator, selfFields, selfTableId, modal } = props;
  const { t } = useTranslation();
  const isFieldMode = isFieldReferenceValue(value);
  const [lastLiteralValue, setLastLiteralValue] = useState<IFilterItem['value'] | null>(
    isFieldMode ? null : (value as IFilterItem['value'])
  );

  useEffect(() => {
    if (!isFieldReferenceValue(value)) {
      setLastLiteralValue(value as IFilterItem['value']);
    }
  }, [value]);

  const toggleDisabled = !selfFields?.length || !FIELD_REFERENCE_SUPPORTED_OPERATORS.has(operator);

  const handleToggle = () => {
    if (toggleDisabled) {
      return;
    }
    if (isFieldReferenceValue(value)) {
      onSelect(lastLiteralValue ?? null);
      return;
    }
    const fallbackFieldId = selfFields?.[0]?.id;
    if (!fallbackFieldId) {
      return;
    }
    onSelect({
      type: 'field',
      fieldId: fallbackFieldId,
      tableId: selfTableId,
    } satisfies IFieldReferenceValue);
  };

  const handleFieldSelect = (fieldId: string) => {
    if (!fieldId) return;
    onSelect({ type: 'field', fieldId, tableId: selfTableId } satisfies IFieldReferenceValue);
  };

  const buttonLabel = isFieldReferenceValue(value)
    ? t('filter.referenceLookup.switchToValue')
    : t('filter.referenceLookup.switchToField');

  return (
    <div className="flex items-center gap-1">
      {isFieldReferenceValue(value) ? (
        <FieldSelector
          fields={selfFields}
          value={value.fieldId}
          onSelect={handleFieldSelect}
          className="min-w-28 max-w-40"
          modal={modal}
        />
      ) : (
        literalComponent
      )}
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        onClick={handleToggle}
        disabled={toggleDisabled}
        title={toggleDisabled ? undefined : buttonLabel}
      >
        <RefreshCcw className="size-4" />
      </Button>
    </div>
  );
};

export function BaseFieldValue(props: IBaseFieldValue) {
  const {
    onSelect,
    components,
    field,
    operator,
    value,
    linkContext,
    modal,
    selfFields,
    selfTableId,
    enableFieldReference,
  } = props;
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

  const wrapWithReference = (component: JSX.Element) => {
    if (!enableFieldReference || !FIELD_REFERENCE_SUPPORTED_OPERATORS.has(operator)) {
      return component;
    }
    return (
      <ReferenceLookupValue
        literalComponent={component}
        value={value}
        onSelect={onSelect}
        operator={operator}
        selfFields={selfFields}
        selfTableId={selfTableId}
        modal={modal}
      />
    );
  };

  switch (field?.type) {
    case FieldType.Number:
      return wrapWithReference(
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
      return wrapWithReference(
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
      return wrapWithReference(getFormulaValueComponent(field.cellValueType));
    case FieldType.ReferenceLookup:
      return wrapWithReference(getFormulaValueComponent(field.cellValueType));
    default:
      return wrapWithReference(InputComponent);
  }
}
