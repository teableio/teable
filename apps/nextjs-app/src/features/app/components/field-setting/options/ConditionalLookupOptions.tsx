import type { IConditionalLookupOptions } from '@teable/core';
import { FieldType, SortFunc } from '@teable/core';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { useBaseId, useFields, useTable, useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Button, Input } from '@teable/ui-lib/shadcn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn/ui/select';
import { Trans, useTranslation } from 'next-i18next';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { LookupFilterOptions } from '../lookup-options/LookupFilterOptions';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
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
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fields = useFields({ withHidden: true, withDenied: true });
  const sortCandidates = useMemo(() => fields.filter((f) => f.type !== FieldType.Button), [fields]);
  const [limitDraft, setLimitDraft] = useState(limit != null ? String(limit) : '');

  useEffect(() => {
    setLimitDraft(limit != null ? String(limit) : '');
  }, [limit]);

  const handleSortFieldChange = useCallback(
    (fieldId: string | undefined) => {
      if (!fieldId) {
        onSortChange(undefined);
        return;
      }
      onSortChange({
        fieldId,
        order: sort?.order ?? SortFunc.Asc,
      });
    },
    [onSortChange, sort?.order]
  );

  const handleSortOrderChange = useCallback(
    (order: SortFunc) => {
      if (!sort?.fieldId) return;
      onSortChange({
        fieldId: sort.fieldId,
        order,
      });
    },
    [onSortChange, sort?.fieldId]
  );

  const handleLimitChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLimitDraft(value);
      if (value === '') {
        onLimitChange(undefined);
        return;
      }
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        onLimitChange(parsed);
      }
    },
    [onLimitChange]
  );

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

      <div className="space-y-2">
        <span className="neutral-content label-text">
          {t('table:field.editor.conditionalLookup.sortLabel')}
        </span>
        <div className="flex w-full flex-col gap-2">
          <Select value={sort?.fieldId ?? undefined} onValueChange={handleSortFieldChange}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder={t('table:field.editor.selectField')} />
            </SelectTrigger>
            <SelectContent>
              {sortCandidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Select
              value={(sort?.order ?? SortFunc.Asc) as string}
              onValueChange={(value) => handleSortOrderChange(value as SortFunc)}
              disabled={!sort?.fieldId}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue
                  placeholder={t('table:field.editor.conditionalLookup.orderPlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SortFunc.Asc}>asc</SelectItem>
                <SelectItem value={SortFunc.Desc}>desc</SelectItem>
              </SelectContent>
            </Select>
            {sort?.fieldId ? (
              <Button size="xs" variant="ghost" onClick={() => onSortChange(undefined)}>
                {t('table:field.editor.conditionalLookup.clearSort')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <span className="neutral-content label-text">
          {t('table:field.editor.conditionalLookup.limitLabel')}
        </span>
        <Input
          className="h-9"
          type="number"
          min={1}
          step={1}
          value={limitDraft}
          placeholder={t('table:field.editor.conditionalLookup.limitPlaceholder')}
          onChange={handleLimitChange}
        />
      </div>
    </div>
  );
};
