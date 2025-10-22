import {
  assertNever,
  CellValueType,
  FieldType,
  isFieldReferenceValue,
  isFieldReferenceOperatorSupported,
  isFieldReferenceComparable,
  exactDate,
  exactFormatDate,
} from '@teable/core';
import type { IDateFilter, IFilterItem, IFieldReferenceValue, IOperator } from '@teable/core';
import { Switch } from '@teable/icons';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib';
import { cloneElement, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
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

export interface IFilterReferenceSource {
  fields: IFieldInstance[];
  tableId?: string;
}

interface IBaseFieldValue {
  value: unknown;
  operator: IFilterItem['operator'];
  onSelect: (value: IFilterItem['value']) => void;
  field?: IFieldInstance;
  components?: IFilterComponents;
  linkContext?: ILinkContext;
  modal?: boolean;
  referenceSource?: IFilterReferenceSource;
}

interface IConditionalRollupValueProps {
  literalComponent: JSX.Element;
  value: unknown;
  onSelect: (value: IFilterItem['value']) => void;
  operator: IFilterItem['operator'];
  referenceSource?: IFilterReferenceSource;
  modal?: boolean;
  field?: IFieldInstance;
}

const ConditionalRollupValue = (props: IConditionalRollupValueProps) => {
  const { literalComponent, value, onSelect, operator, referenceSource, modal, field } = props;
  const { t } = useTranslation();
  const referenceFields = referenceSource?.fields ?? [];
  const referenceTableId = referenceSource?.tableId ?? referenceFields[0]?.tableId;
  const isFieldMode = isFieldReferenceValue(value);
  const [lastLiteralValue, setLastLiteralValue] = useState<IFilterItem['value'] | null>(
    isFieldMode ? null : (value as IFilterItem['value'])
  );
  const [literalModeHint, setLiteralModeHint] = useState<IDateFilter['mode'] | null>(null);

  const handleLiteralModeChange = useCallback((mode: IDateFilter['mode'] | null) => {
    setLiteralModeHint(mode ?? null);
  }, []);

  useEffect(() => {
    if (!isFieldReferenceValue(value)) {
      setLastLiteralValue(value as IFilterItem['value']);
    }
  }, [value]);

  const operatorSupportsReferences = useMemo(() => {
    if (!field || !operator) {
      return false;
    }
    return isFieldReferenceOperatorSupported(field, operator as IOperator);
  }, [field, operator]);

  const isReferenceFieldDisabled = useCallback(
    (candidate: IFieldInstance) => {
      if (!field) {
        return false;
      }
      return !isFieldReferenceComparable(field, candidate);
    },
    [field]
  );

  const toggleDisabled = !operatorSupportsReferences || !referenceFields.length;

  const handleToggle = () => {
    if (toggleDisabled) {
      return;
    }
    if (isFieldReferenceValue(value)) {
      onSelect(lastLiteralValue ?? null);
      return;
    }
    const comparableField = referenceFields.find(
      (candidate) => !isReferenceFieldDisabled(candidate)
    );
    const targetField = comparableField ?? referenceFields[0];
    if (!targetField) {
      return;
    }
    onSelect({
      type: 'field',
      fieldId: targetField.id,
      tableId: targetField.tableId ?? referenceTableId,
    } satisfies IFieldReferenceValue);
  };

  const handleFieldSelect = (fieldId: string) => {
    if (!fieldId) return;
    onSelect({
      type: 'field',
      fieldId,
      tableId: referenceTableId,
    } satisfies IFieldReferenceValue);
  };

  const fieldModeTooltip = t('filter.conditionalRollup.switchToValue');
  const literalModeTooltip = t('filter.conditionalRollup.switchToField');
  const tooltipLabel = isFieldReferenceValue(value) ? fieldModeTooltip : literalModeTooltip;

  const literalCandidate = isFieldReferenceValue(value) ? lastLiteralValue : value;

  useEffect(() => {
    if (isFieldReferenceValue(value)) {
      return;
    }
    if (literalCandidate && typeof literalCandidate === 'object' && 'mode' in literalCandidate) {
      setLiteralModeHint((literalCandidate as IDateFilter).mode ?? null);
    }
  }, [literalCandidate, value]);

  const shouldHideToggle = useMemo(() => {
    if (isFieldReferenceValue(value)) {
      return false;
    }
    if (!field || field.cellValueType !== CellValueType.DateTime) {
      return false;
    }
    if (!literalModeHint) {
      return false;
    }
    return [exactDate.value, exactFormatDate.value].includes(
      literalModeHint as 'exactDate' | 'exactFormatDate'
    );
  }, [field, literalModeHint, value]);

  const mergedLiteralComponent = useMemo(() => {
    const element = literalComponent as ReactElement<{
      className?: string;
      onModeChange?: unknown;
    }>;
    const existingModeChange = (
      element.props as {
        onModeChange?: (mode: IDateFilter['mode'] | null) => void;
      }
    ).onModeChange;
    return cloneElement(element, {
      className: cn(
        element.props.className,
        '!h-9 min-w-[8rem] w-full',
        shouldHideToggle ? null : 'rounded-r-none border-r-0'
      ),
      onModeChange: (mode: IDateFilter['mode'] | null) => {
        handleLiteralModeChange(mode);
        existingModeChange?.(mode);
      },
    });
  }, [handleLiteralModeChange, literalComponent, shouldHideToggle]);

  if (shouldHideToggle) {
    return mergedLiteralComponent;
  }

  return (
    <div className="flex items-stretch">
      {isFieldReferenceValue(value) ? (
        <FieldSelector
          fields={referenceFields}
          value={value.fieldId}
          onSelect={handleFieldSelect}
          modal={modal}
          className="!h-9 w-40 rounded-r-none border-r-0"
          showTableName={Boolean(referenceTableId)}
          tableId={referenceTableId}
          isOptionDisabled={isReferenceFieldDisabled}
        />
      ) : (
        mergedLiteralComponent
      )}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="-ml-px size-9 shrink-0 rounded-l-none border-input"
              onClick={handleToggle}
              disabled={toggleDisabled}
              aria-label={tooltipLabel}
            >
              <Switch className="size-4" />
            </Button>
          </TooltipTrigger>
          {!toggleDisabled ? (
            <TooltipContent>
              <span>{tooltipLabel}</span>
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

export function BaseFieldValue(props: IBaseFieldValue) {
  const { onSelect, components, field, operator, value, linkContext, modal, referenceSource } =
    props;
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
      className="w-40"
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
            className="w-40 placeholder:text-xs"
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
    if (
      !referenceSource?.fields?.length ||
      !field ||
      !operator ||
      !isFieldReferenceOperatorSupported(field, operator as IOperator)
    ) {
      return component;
    }
    return (
      <ConditionalRollupValue
        literalComponent={component}
        value={value}
        onSelect={onSelect}
        operator={operator}
        referenceSource={referenceSource}
        modal={modal}
        field={field}
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
          className="w-40 placeholder:text-xs"
          placeholder={t('filter.default.placeholder')}
        />
      );
    case FieldType.SingleSelect:
      return wrapWithReference(
        ARRAY_OPERATORS.includes(operator) ? (
          <FilterMultipleSelect
            field={field}
            modal={modal}
            value={value as string[]}
            onSelect={(newValue) => onSelect(newValue as IFilterItem['value'])}
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
        )
      );
    case FieldType.MultipleSelect:
      return wrapWithReference(
        <FilterMultipleSelect
          field={field}
          modal={modal}
          value={value as string[]}
          onSelect={(newValue) => onSelect(newValue as IFilterItem['value'])}
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
      return wrapWithReference(
        <FilterCheckbox value={value as boolean} onChange={onSelect} className="w-10" />
      );
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
      return wrapWithReference(
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
        return wrapWithReference(<UserComponents {...props} />);
      }
      return wrapWithReference(<FilterUserSelect {...props} modal={modal} />);
    }
    case FieldType.Rollup:
    case FieldType.Formula:
      return wrapWithReference(getFormulaValueComponent(field.cellValueType));
    case FieldType.ConditionalRollup:
      return wrapWithReference(getFormulaValueComponent(field.cellValueType));
    default:
      return wrapWithReference(InputComponent);
  }
}
