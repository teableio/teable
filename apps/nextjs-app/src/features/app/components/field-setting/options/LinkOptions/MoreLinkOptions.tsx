import { useQuery } from '@tanstack/react-query';
import { PRIMARY_SUPPORTED_TYPES, type IFilter, type ILinkFieldOptionsRo } from '@teable/core';
import { EyeOff, Maximize2 } from '@teable/icons';
import { getFields } from '@teable/openapi';
import {
  FilterWithTable,
  HideFieldsBase,
  useFieldFilterLinkContext,
  ViewSelect,
  FieldSelector,
} from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTableId } from '@teable/sdk/hooks';
import { createFieldInstance, type IFieldInstance } from '@teable/sdk/model';
import { Button, cn, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IMoreOptionsProps {
  foreignTableId?: string;
  fieldId?: string;
  filter?: IFilter | null;
  filterByViewId?: string | null;
  lookupFieldId?: string | null;
  visibleFieldIds?: string[] | null;
  onChange?: (options: Partial<ILinkFieldOptionsRo>) => void;
}

export const MoreLinkOptions = (props: IMoreOptionsProps) => {
  const {
    foreignTableId = '',
    fieldId,
    filterByViewId,
    visibleFieldIds: _visibleFieldIds,
    filter,
    lookupFieldId,
    onChange,
  } = props;

  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const currentTableId = useTableId() as string;
  const visibleFieldIds = useMemo(() => _visibleFieldIds ?? [], [_visibleFieldIds]);

  const query = useMemo(() => {
    return {
      viewId: filterByViewId ?? undefined,
    };
  }, [filterByViewId]);

  const { data: totalFields = [] } = useQuery({
    queryKey: ReactQueryKeys.fieldList(foreignTableId),
    queryFn: () => getFields(foreignTableId).then((res) => res.data),
    enabled: !!foreignTableId,
  });

  const primaryField = useMemo(() => {
    return totalFields.find((field) => field.isPrimary);
  }, [totalFields]);

  const fieldInstances = useMemo(() => {
    return totalFields
      .filter((field) => PRIMARY_SUPPORTED_TYPES.has(field.type))
      .map((field) => createFieldInstance(field));
  }, [totalFields]);

  const { data: withViewFields } = useQuery({
    queryKey: ReactQueryKeys.fieldList(foreignTableId, query),
    queryFn: () => getFields(foreignTableId, query).then((res) => res.data),
    enabled: !!foreignTableId && !!filterByViewId,
  });

  const context = useFieldFilterLinkContext(currentTableId, fieldId, !fieldId);

  const hiddenFieldIds = useMemo(() => {
    // Default all fields are visible
    if (!visibleFieldIds.length) return [];

    return totalFields
      ?.filter((field) => !visibleFieldIds.includes(field.id) && !field.isPrimary)
      .map((field) => field.id);
  }, [totalFields, visibleFieldIds]);

  if (!foreignTableId || !totalFields.length) {
    return null;
  }

  const visibleCount = visibleFieldIds.length;
  const text = visibleCount
    ? t('sdk:hidden.configLabel_other_visible', { count: visibleCount })
    : t('sdk:hidden.label');

  const onHiddenChange = (hiddenFieldIds: string[]) => {
    const hiddenFieldSet = new Set(hiddenFieldIds);
    const visibleFieldIds = totalFields
      .filter((field) => !hiddenFieldSet.has(field.id))
      .map((field) => field.id);
    onChange?.({ visibleFieldIds: visibleFieldIds.length ? visibleFieldIds : null });
  };

  return (
    <div className="mt-2 flex flex-col gap-4 text-sm font-medium">
      <div className="flex flex-col gap-2">
        <span>{t('table:field.editor.showByField')}</span>
        <FieldSelector
          fields={fieldInstances}
          value={lookupFieldId ?? primaryField?.id}
          onSelect={(fieldId) => onChange?.({ lookupFieldId: fieldId ?? undefined })}
          className="h-9 w-full max-w-none"
          modal
        />
      </div>
      <div className="flex flex-col gap-2">
        <span>{t('table:field.editor.filterByView')}</span>
        <ViewSelect
          tableId={foreignTableId}
          value={filterByViewId}
          onChange={(viewId) => onChange?.({ filterByViewId: viewId })}
          cancelable
          className="my-0 h-9 w-full max-w-none"
        />
      </div>
      <div className="flex flex-col gap-1 rounded-md border px-3 pt-2">
        <div className="flex items-center justify-between">
          <span>{t('table:field.editor.filter')}</span>
          <Dialog>
            <DialogTrigger asChild>
              <Button size={'xs'} variant={'ghost'}>
                <Maximize2 />
              </Button>
            </DialogTrigger>
            <DialogContent className="min-w-96 max-w-fit">
              <FilterWithTable
                fields={totalFields as IFieldInstance[]}
                value={filter ?? null}
                context={context}
                onChange={(value) => onChange?.({ filter: value })}
              />
            </DialogContent>
          </Dialog>
        </div>
        <FilterWithTable
          fields={totalFields as IFieldInstance[]}
          value={filter ?? null}
          context={context}
          onChange={(value) => onChange?.({ filter: value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span>{t('table:field.editor.hideFields')}</span>
        <HideFieldsBase
          fields={(withViewFields ?? totalFields) as IFieldInstance[]}
          hidden={hiddenFieldIds}
          onChange={onHiddenChange}
        >
          <Button
            variant={'outline'}
            className={cn('font-normal shrink-0 truncate text-sm ', {
              'bg-secondary hover:opacity-80 ': Boolean(visibleCount),
            })}
          >
            <EyeOff className="size-4" />
            {text}
          </Button>
        </HideFieldsBase>
      </div>
    </div>
  );
};
