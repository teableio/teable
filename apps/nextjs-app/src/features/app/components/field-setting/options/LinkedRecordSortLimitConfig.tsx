import {
  FieldType,
  SortFunc,
  clampConditionalLimit,
  normalizeConditionalLimit,
  CONDITIONAL_QUERY_DEFAULT_LIMIT,
  CONDITIONAL_QUERY_MAX_LIMIT,
} from '@teable/core';
import { FieldCommand, FieldSelector, OrderSelect } from '@teable/sdk';
import { useFields } from '@teable/sdk/hooks';
import { Input, Switch } from '@teable/ui-lib/shadcn';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export interface ISortOrderValue {
  fieldId: string;
  order: SortFunc;
}

interface ILinkedRecordSortLimitConfigProps {
  sort?: ISortOrderValue;
  limit?: number;
  defaultLimit?: number;
  onSortChange: (sort?: ISortOrderValue) => void;
  onLimitChange: (limit?: number) => void;
  toggleTestId?: string;
}

const DEFAULT_LIMIT = CONDITIONAL_QUERY_DEFAULT_LIMIT;
const MAX_LIMIT = CONDITIONAL_QUERY_MAX_LIMIT;
const TOGGLE_FALLBACK_LIMIT = 1;

export const LinkedRecordSortLimitConfig = ({
  sort,
  limit,
  defaultLimit = DEFAULT_LIMIT,
  onSortChange,
  onLimitChange,
  toggleTestId = 'linked-record-sort-limit-toggle',
}: ILinkedRecordSortLimitConfigProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const selectFieldPlaceholder = t('table:field.editor.selectField');
  const switchLabel = t('table:field.editor.conditionalLookup.sortLimitToggleLabel');
  const sortLabel = t('table:field.editor.conditionalLookup.sortLabel');
  const limitLabel = t('table:field.editor.conditionalLookup.limitLabel');
  const limitPlaceholder = t('table:field.editor.conditionalLookup.limitPlaceholder');
  const limitHint = t('table:field.editor.conditionalLookup.limitHint', { limit: MAX_LIMIT });
  const sortMissingTitle = t('table:field.editor.conditionalLookup.sortMissingWarningTitle');
  const sortMissingDescription = t(
    'table:field.editor.conditionalLookup.sortMissingWarningDescription'
  );

  const fields = useFields({ withHidden: true, withDenied: true });
  const sortCandidates = useMemo(() => fields.filter((f) => f.type !== FieldType.Button), [fields]);
  const sortFieldMissing = useMemo(() => {
    if (!sort?.fieldId) return false;
    return !sortCandidates.some((candidate) => candidate.id === sort.fieldId);
  }, [sort?.fieldId, sortCandidates]);

  const derivedEnabled = Boolean(sort || limit);
  const [limitDraft, setLimitDraft] = useState(limit != null ? String(limit) : '');
  const [localOverride, setLocalOverride] = useState<boolean | null>(null);
  const sortLimitEnabled = localOverride ?? derivedEnabled;

  useEffect(() => {
    if (limit != null) {
      const sanitized = clampConditionalLimit(limit);
      if (sanitized != null) {
        setLimitDraft(String(sanitized));
        if (sanitized !== limit) {
          onLimitChange(sanitized);
        }
        return;
      }
      const fallback = normalizeConditionalLimit(TOGGLE_FALLBACK_LIMIT);
      setLimitDraft(String(fallback));
      if (limit !== fallback) {
        onLimitChange(fallback);
      }
      return;
    }
    if (!sortLimitEnabled) {
      setLimitDraft('');
    }
  }, [limit, onLimitChange, sortLimitEnabled]);

  useEffect(() => {
    if (localOverride !== null && derivedEnabled === localOverride) {
      setLocalOverride(null);
    }
  }, [derivedEnabled, localOverride]);

  const handleSortLimitToggle = useCallback(
    (checked: boolean) => {
      setLocalOverride(checked);

      if (checked) {
        if (limit == null) {
          const baseDefault =
            Number.isInteger(defaultLimit) && defaultLimit > 0 ? defaultLimit : DEFAULT_LIMIT;
          const toggleDefault = baseDefault >= MAX_LIMIT ? TOGGLE_FALLBACK_LIMIT : baseDefault;
          const normalizedDefault =
            clampConditionalLimit(toggleDefault) ??
            normalizeConditionalLimit(TOGGLE_FALLBACK_LIMIT);
          setLimitDraft(String(normalizedDefault));
          onLimitChange(normalizedDefault);
        }
        return;
      }

      setLimitDraft('');
      onSortChange(undefined);
      onLimitChange(undefined);
    },
    [defaultLimit, limit, onLimitChange, onSortChange]
  );

  const handleSortFieldChange = useCallback(
    (fieldId: string) => {
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
      if (!/^\d*$/.test(value)) {
        return;
      }

      if (value === '') {
        setLimitDraft('');
        onLimitChange(undefined);
        return;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) {
        return;
      }
      const sanitized = clampConditionalLimit(parsed);
      if (sanitized == null) {
        setLimitDraft(value);
        onLimitChange(undefined);
        return;
      }

      setLimitDraft(String(sanitized));
      onLimitChange(sanitized);
    },
    [onLimitChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <span className="label-text text-sm">{switchLabel}</span>
        <Switch
          checked={sortLimitEnabled}
          onCheckedChange={handleSortLimitToggle}
          data-testid={toggleTestId}
        />
      </div>
      <span className="block text-xs text-muted-foreground">{limitHint}</span>

      {!sortLimitEnabled ? null : (
        <div className="space-y-4">
          {sortFieldMissing ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="space-y-1 text-warning">
                <span className="block text-sm font-medium leading-none">{sortMissingTitle}</span>
                <span className="block text-xs text-warning/90">{sortMissingDescription}</span>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <span className="neutral-content label-text">{sortLabel}</span>
            {sort?.fieldId ? (
              <div className="flex items-center gap-2">
                <FieldSelector
                  value={sort.fieldId}
                  fields={sortCandidates}
                  onSelect={handleSortFieldChange}
                  className="h-9 !max-w-none flex-1 justify-between"
                />
                <OrderSelect
                  value={sort.order ?? SortFunc.Asc}
                  onSelect={handleSortOrderChange}
                  fieldId={sort.fieldId}
                  triggerClassName="mx-0 h-9 w-32"
                />
              </div>
            ) : (
              <FieldCommand
                fields={sortCandidates}
                onSelect={handleSortFieldChange}
                placeholder={selectFieldPlaceholder}
              />
            )}
          </div>

          <div className="space-y-2">
            <span className="neutral-content label-text">{limitLabel}</span>
            <Input
              className="h-9"
              type="text"
              inputMode="numeric"
              pattern="\d*"
              value={limitDraft}
              placeholder={limitPlaceholder}
              onChange={handleLimitChange}
            />
          </div>
        </div>
      )}
    </div>
  );
};
