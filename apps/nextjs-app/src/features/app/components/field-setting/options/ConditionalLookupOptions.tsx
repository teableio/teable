import { CONDITIONAL_QUERY_DEFAULT_LIMIT, type IConditionalLookupOptions } from '@teable/core';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { useBaseId, useTable, useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Trans } from 'next-i18next';
import { useCallback } from 'react';
import { LookupFilterOptions } from '../lookup-options/LookupFilterOptions';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import { LinkedRecordSortLimitConfig } from './LinkedRecordSortLimitConfig';
import { SelectTable } from './LinkOptions/SelectTable';

interface IConditionalLookupOptionsProps {
  fieldId?: string;
  options?: IConditionalLookupOptions;
  onOptionsChange: (
    partial: Partial<IConditionalLookupOptions>,
    lookupField?: IFieldInstance
  ) => void;
}

export const ConditionalLookupOptions = ({
  fieldId,
  options,
  onOptionsChange,
}: IConditionalLookupOptionsProps) => {
  const baseId = useBaseId();
  const sourceTableId = useTableId();
  const effectiveOptions = options ?? ({} as IConditionalLookupOptions);

  const handleTableChange = useCallback(
    (nextBaseId?: string, tableId?: string) => {
      onOptionsChange({
        baseId: nextBaseId,
        foreignTableId: tableId,
        lookupFieldId: undefined,
        filter: undefined,
      });
    },
    [onOptionsChange]
  );

  const handleLookupField = useCallback(
    (lookupField: IFieldInstance) => {
      onOptionsChange(
        {
          lookupFieldId: lookupField.id,
        },
        lookupField
      );
    },
    [onOptionsChange]
  );

  const foreignTableId = effectiveOptions.foreignTableId;
  const effectiveBaseId = effectiveOptions.baseId ?? baseId;

  return (
    <div className="flex w-full flex-col gap-3" data-testid="conditional-lookup-options">
      <SelectTable
        baseId={effectiveOptions.baseId}
        tableId={foreignTableId}
        onChange={handleTableChange}
      />

      {foreignTableId ? (
        <StandaloneViewProvider baseId={effectiveBaseId} tableId={foreignTableId}>
          <ConditionalLookupForeignSection
            fieldId={fieldId}
            foreignTableId={foreignTableId}
            lookupFieldId={effectiveOptions.lookupFieldId}
            filter={effectiveOptions.filter}
            sort={effectiveOptions.sort}
            limit={effectiveOptions.limit}
            onLookupFieldChange={handleLookupField}
            onFilterChange={(filter) => onOptionsChange({ filter: filter ?? undefined })}
            onSortChange={(sort) => onOptionsChange({ sort })}
            onLimitChange={(limit) => onOptionsChange({ limit })}
            sourceTableId={sourceTableId}
          />
        </StandaloneViewProvider>
      ) : null}
    </div>
  );
};

interface IConditionalLookupForeignSectionProps {
  fieldId?: string;
  foreignTableId: string;
  lookupFieldId?: string;
  filter?: IConditionalLookupOptions['filter'];
  sort?: IConditionalLookupOptions['sort'];
  limit?: number;
  onLookupFieldChange: (field: IFieldInstance) => void;
  onFilterChange: (filter: IConditionalLookupOptions['filter']) => void;
  onSortChange: (sort?: IConditionalLookupOptions['sort']) => void;
  onLimitChange: (limit?: number) => void;
  sourceTableId?: string;
}

const ConditionalLookupForeignSection = ({
  fieldId,
  foreignTableId,
  lookupFieldId,
  filter,
  sort,
  limit,
  onLookupFieldChange,
  onFilterChange,
  onSortChange,
  onLimitChange,
  sourceTableId,
}: IConditionalLookupForeignSectionProps) => {
  const table = useTable();

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {table?.name ? (
          <span className="neutral-content label-text">
            <Trans
              ns="table"
              i18nKey="field.editor.lookupToTable"
              values={{ tableName: table.name }}
              components={{ bold: <span className="font-semibold" /> }}
            />
          </span>
        ) : null}
        <SelectFieldByTableId selectedId={lookupFieldId} onChange={onLookupFieldChange} />
      </div>

      <LookupFilterOptions
        fieldId={fieldId}
        foreignTableId={foreignTableId}
        filter={filter ?? null}
        enableFieldReference
        contextTableId={sourceTableId}
        required
        onChange={(nextFilter) => onFilterChange(nextFilter ?? null)}
      />

      <LinkedRecordSortLimitConfig
        sort={sort}
        limit={limit}
        onSortChange={onSortChange}
        onLimitChange={onLimitChange}
        defaultLimit={CONDITIONAL_QUERY_DEFAULT_LIMIT}
        toggleTestId="conditional-lookup-sort-limit-toggle"
      />
    </div>
  );
};
