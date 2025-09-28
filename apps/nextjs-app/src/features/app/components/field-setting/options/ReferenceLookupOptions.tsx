/* eslint-disable sonarjs/cognitive-complexity */
import type {
  IReferenceLookupFieldOptions,
  RollupFunction,
  IRollupFieldOptions,
} from '@teable/core';
import { CellValueType, getRollupFunctionsByCellValueType, ROLLUP_FUNCTIONS } from '@teable/core';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { useBaseId, useFields, useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Trans } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { LookupFilterOptions } from '../lookup-options/LookupFilterOptions';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import { SelectTable } from './LinkOptions/SelectTable';
import { RollupOptions } from './RollupOptions';

interface IReferenceLookupOptionsProps {
  fieldId?: string;
  options?: Partial<IReferenceLookupFieldOptions>;
  onChange?: (options: Partial<IReferenceLookupFieldOptions>) => void;
}

export const ReferenceLookupOptions = ({
  fieldId,
  options = {},
  onChange,
}: IReferenceLookupOptionsProps) => {
  const baseId = useBaseId();
  const sourceTableId = useTableId();

  const handlePartialChange = useCallback(
    (partial: Partial<IReferenceLookupFieldOptions>) => {
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
      const allowedExpressions = getRollupFunctionsByCellValueType(cellValueType);
      const fallbackExpression = allowedExpressions[0] ?? ROLLUP_FUNCTIONS[0];
      const currentExpression = options.expression as RollupFunction | undefined;
      const expressionToUse = allowedExpressions.includes(currentExpression as RollupFunction)
        ? currentExpression!
        : fallbackExpression;

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
    <div className="flex w-full flex-col gap-3" data-testid="reference-lookup-options">
      <SelectTable baseId={options.baseId} tableId={foreignTableId} onChange={handleTableChange} />

      {foreignTableId ? (
        <StandaloneViewProvider baseId={effectiveBaseId} tableId={foreignTableId}>
          <ReferenceLookupForeignSection
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

interface IReferenceLookupForeignSectionProps {
  fieldId?: string;
  options: Partial<IReferenceLookupFieldOptions>;
  onOptionsChange: (options: Partial<IReferenceLookupFieldOptions>) => void;
  onLookupFieldChange: (field: IFieldInstance) => void;
  rollupOptions: Partial<IRollupFieldOptions>;
  sourceTableId?: string;
}

const ReferenceLookupForeignSection = (props: IReferenceLookupForeignSectionProps) => {
  const { fieldId, options, onOptionsChange, onLookupFieldChange, rollupOptions, sourceTableId } =
    props;
  const foreignFields = useFields({ withHidden: true, withDenied: true });

  const lookupField = useMemo(() => {
    if (!options.lookupFieldId) return undefined;
    return foreignFields.find((field) => field.id === options.lookupFieldId);
  }, [foreignFields, options.lookupFieldId]);

  const cellValueType = lookupField?.cellValueType ?? CellValueType.String;
  const isMultipleCellValue = lookupField?.isMultipleCellValue ?? false;

  const availableExpressions = useMemo(
    () => getRollupFunctionsByCellValueType(cellValueType),
    [cellValueType]
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="neutral-content label-text">
          <Trans ns="table" i18nKey="field.editor.lookupToTable" values={{ tableName: '' }} />
        </span>
        <SelectFieldByTableId selectedId={options.lookupFieldId} onChange={onLookupFieldChange} />
      </div>

      <RollupOptions
        options={rollupOptions}
        cellValueType={cellValueType}
        isMultipleCellValue={isMultipleCellValue}
        availableExpressions={availableExpressions}
        onChange={(partial) => onOptionsChange(partial)}
      />

      <LookupFilterOptions
        fieldId={fieldId}
        foreignTableId={options.foreignTableId!}
        filter={options.filter ?? null}
        enableFieldReference
        contextTableId={sourceTableId}
        onChange={(filter) => {
          onOptionsChange({ filter: filter ?? undefined });
        }}
      />
    </div>
  );
};
