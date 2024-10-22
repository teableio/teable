import { useQuery } from '@tanstack/react-query';
import type { IFilter, ILinkFieldOptionsRo } from '@teable/core';
import { EyeOff, Maximize2 } from '@teable/icons';
import { getFields } from '@teable/openapi';
import {
  FilterWithTable,
  HideFieldsBase,
  useFieldFilterLinkContext,
  ViewSelect,
} from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Button, cn, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IMoreOptionsProps {
  foreignTableId?: string;
  fieldId?: string;
  filter?: IFilter | null;
  filterByViewId?: string | null;
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

  const { data: withViewFields } = useQuery({
    queryKey: ReactQueryKeys.fieldList(foreignTableId, query),
    queryFn: () => getFields(foreignTableId, query).then((res) => res.data),
    enabled: !!foreignTableId && !!filterByViewId,
  });

  const context = useFieldFilterLinkContext(currentTableId, fieldId, !fieldId);

  const hiddenFieldIds = useMemo(() => {
    return totalFields
      ?.filter((field) => !visibleFieldIds.includes(field.id) && !field.isPrimary)
      .map((field) => field.id);
  }, [totalFields, visibleFieldIds]);

  if (!foreignTableId || !totalFields.length) {
    return null;
  }

  const visibleCount = visibleFieldIds.length;
  const text = visibleCount
    ? t('sdk:hidden.configLabel_other', { count: visibleCount })
    : t('sdk:hidden.label');

  const onHiddenChange = (hiddenFieldIds: string[]) => {
    const hiddenFieldSet = new Set(hiddenFieldIds);
    const visibleFieldIds = totalFields
      .filter((field) => !hiddenFieldSet.has(field.id))
      .map((field) => field.id);
    console.log('visibleFieldIds', visibleFieldIds);
    onChange?.({ visibleFieldIds: visibleFieldIds.length ? visibleFieldIds : null });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border px-2 py-3">
      <div className="flex flex-col gap-2">
        <span>{t('table:field.editor.filterByView')}</span>
        <ViewSelect
          tableId={foreignTableId}
          value={filterByViewId}
          onChange={(viewId) => onChange?.({ filterByViewId: viewId })}
          cancelable
        />
      </div>
      <div className="flex flex-col gap-1">
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
            variant={'ghost'}
            className={cn('font-normal shrink-0 truncate text-[13px]', {
              'bg-secondary': Boolean(visibleCount),
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
