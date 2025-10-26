/* eslint-disable sonarjs/cognitive-complexity */
import type {
  IConditionalRollupFieldOptions,
  RollupFunction,
  IRollupFieldOptions,
} from '@teable/core';
import {
  CellValueType,
  getRollupFunctionsByCellValueType,
  ROLLUP_FUNCTIONS,
  CONDITIONAL_QUERY_DEFAULT_LIMIT,
} from '@teable/core';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { useBaseId, useFields, useTable, useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Trans } from 'next-i18next';
import { useCallback, useEffect, useMemo } from 'react';
import { LookupFilterOptions } from '../lookup-options/LookupFilterOptions';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import { LinkedRecordSortLimitConfig } from './LinkedRecordSortLimitConfig';
import { SelectTable } from './LinkOptions/SelectTable';
import { RollupOptions } from './RollupOptions';

const RAW_VALUE_EXPRESSION = 'concatenate({values})' as RollupFunction;
const SORT_LIMIT_ENABLED_EXPRESSIONS: RollupFunction[] = [
  'array_compact({values})',
  'array_join({values})',
  'array_unique({values})',
  'concatenate({values})',
];

interface IConditionalRollupOptionsProps {
  fieldId?: string;
  options?: Partial<IConditionalRollupFieldOptions>;
  onChange?: (options: Partial<IConditionalRollupFieldOptions>) => void;
}

export const ConditionalRollupOptions = ({
  fieldId,
  options = {},
  onChange,
}: IConditionalRollupOptionsProps) => {
  const baseId = useBaseId();
  const sourceTableId = useTableId();

  const handlePartialChange = useCallback(
    (partial: Partial<IConditionalRollupFieldOptions>) => {
      onChange?.({ ...options, ...partial });
    },
    [onChange, options]
  );

  const handleTableChange = useCallback(
    (nextBaseId?: string, tableId?: string) => {
      handlePartialChange({
        baseId: nextBaseId,
        foreignTableId: tableId,
        lookupFieldId: undefined,
        filter: undefined,
      });
    },
    [handlePartialChange]
  );

  const handleLookupField = useCallback(
    (lookupField: IFieldInstance) => {
      const cellValueType = lookupField?.cellValueType ?? CellValueType.String;
      const allowedExpressions = getRollupFunctionsByCellValueType(cellValueType).filter(
        (expr) => expr !== RAW_VALUE_EXPRESSION
      );
      const fallbackExpression =
        allowedExpressions[0] ??
        ROLLUP_FUNCTIONS.find((expr) => expr !== RAW_VALUE_EXPRESSION) ??
        ROLLUP_FUNCTIONS[0];
      const currentExpression = options.expression as RollupFunction | undefined;
      const isCurrentAllowed =
        currentExpression !== undefined && allowedExpressions.includes(currentExpression);
      const expressionToUse = isCurrentAllowed ? currentExpression : fallbackExpression;

      handlePartialChange({
        lookupFieldId: lookupField.id,
        expression: expressionToUse,
      });
    },
    [handlePartialChange, options.expression]
  );

  const rollupOptions = useMemo(() => {
    return {
      expression: options.expression,
      formatting: options.formatting,
      showAs: options.showAs,
      timeZone: options.timeZone,
    } as Partial<IRollupFieldOptions>;
  }, [options.expression, options.formatting, options.showAs, options.timeZone]);

  const effectiveBaseId = options.baseId ?? baseId;
  const foreignTableId = options.foreignTableId;

  return (
    <div className="flex w-full flex-col gap-3" data-testid="conditional-rollup-options">
      <SelectTable baseId={options.baseId} tableId={foreignTableId} onChange={handleTableChange} />

      {foreignTableId ? (
        <StandaloneViewProvider baseId={effectiveBaseId} tableId={foreignTableId}>
          <ConditionalRollupForeignSection
            fieldId={fieldId}
            options={options}
            onOptionsChange={handlePartialChange}
            onLookupFieldChange={handleLookupField}
            rollupOptions={rollupOptions}
            sourceTableId={sourceTableId}
          />
        </StandaloneViewProvider>
      ) : null}
    </div>
  );
};

interface IConditionalRollupForeignSectionProps {
  fieldId?: string;
  options: Partial<IConditionalRollupFieldOptions>;
  onOptionsChange: (options: Partial<IConditionalRollupFieldOptions>) => void;
  onLookupFieldChange: (field: IFieldInstance) => void;
  rollupOptions: Partial<IRollupFieldOptions>;
  sourceTableId?: string;
}

const ConditionalRollupForeignSection = (props: IConditionalRollupForeignSectionProps) => {
  const { fieldId, options, onOptionsChange, onLookupFieldChange, rollupOptions, sourceTableId } =
    props;
  const foreignFields = useFields({ withHidden: true, withDenied: true });
  const table = useTable();

  const lookupField = useMemo(() => {
    if (!options.lookupFieldId) return undefined;
    return foreignFields.find((field) => field.id === options.lookupFieldId);
  }, [foreignFields, options.lookupFieldId]);

  const cellValueType = lookupField?.cellValueType ?? CellValueType.String;
  const isMultipleCellValue = lookupField?.isMultipleCellValue ?? false;
  const expression = options.expression as RollupFunction | undefined;
  const supportsSortLimit =
    expression != null && SORT_LIMIT_ENABLED_EXPRESSIONS.includes(expression);

  const availableExpressions = useMemo(() => {
    if (!lookupField) {
      if (options.lookupFieldId) {
        // Preserve persisted expression until the lookup field info is ready.
        return undefined;
      }
      return ROLLUP_FUNCTIONS.filter((expr) => expr !== RAW_VALUE_EXPRESSION);
    }
    return getRollupFunctionsByCellValueType(lookupField.cellValueType).filter(
      (expr) => expr !== RAW_VALUE_EXPRESSION
    );
  }, [lookupField, options.lookupFieldId]);

  useEffect(() => {
    if (!supportsSortLimit && (options.sort || options.limit)) {
      onOptionsChange({ sort: undefined, limit: undefined });
    }
  }, [supportsSortLimit, options.limit, options.sort, onOptionsChange]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {table?.name ? (
          <span className="neutral-content label-text">
            <Trans
              ns="table"
              i18nKey="field.editor.rollupToTable"
              values={{ tableName: table.name }}
              components={{ bold: <span className="font-semibold" /> }}
            />
          </span>
        ) : null}
        <SelectFieldByTableId selectedId={options.lookupFieldId} onChange={onLookupFieldChange} />
      </div>

      <LookupFilterOptions
        fieldId={fieldId}
        foreignTableId={options.foreignTableId!}
        filter={options.filter ?? null}
        enableFieldReference
        contextTableId={sourceTableId}
        required
        onChange={(filter) => {
          onOptionsChange({ filter: filter ?? undefined });
        }}
      />

      <RollupOptions
        options={rollupOptions}
        cellValueType={cellValueType}
        isMultipleCellValue={isMultipleCellValue}
        availableExpressions={availableExpressions}
        onChange={(partial) => onOptionsChange(partial)}
      />

      {supportsSortLimit ? (
        <LinkedRecordSortLimitConfig
          sort={options.sort}
          limit={options.limit}
          onSortChange={(sortValue) => onOptionsChange({ sort: sortValue })}
          onLimitChange={(limitValue) => onOptionsChange({ limit: limitValue })}
          defaultLimit={CONDITIONAL_QUERY_DEFAULT_LIMIT}
          toggleTestId="conditional-rollup-sort-limit-toggle"
        />
      ) : null}
    </div>
  );
};
