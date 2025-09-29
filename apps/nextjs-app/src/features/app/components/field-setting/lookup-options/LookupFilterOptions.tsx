import { useQuery } from '@tanstack/react-query';
import type { IFilter } from '@teable/core';
import { Maximize2 } from '@teable/icons';
import { getFields } from '@teable/openapi';
import { FilterWithTable, useFieldFilterLinkContext } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { createFieldInstance } from '@teable/sdk/model';
import { Button, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';

interface ILookupFilterOptionsProps {
  fieldId?: string;
  filter?: IFilter | null;
  foreignTableId: string;
  contextTableId?: string;
  onChange?: (filter: IFilter | null) => void;
  enableFieldReference?: boolean;
  required?: boolean;
}

export const LookupFilterOptions = (props: ILookupFilterOptionsProps) => {
  const {
    fieldId,
    foreignTableId,
    filter,
    onChange,
    contextTableId,
    enableFieldReference,
    required,
  } = props;

  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const currentTableId = useTableId() as string;
  const tableIdForContext = contextTableId ?? currentTableId;

  const context = useFieldFilterLinkContext(tableIdForContext, fieldId, !fieldId);

  const { data: totalFields = [] } = useQuery({
    queryKey: ReactQueryKeys.fieldList(foreignTableId),
    queryFn: () => getFields(foreignTableId).then((res) => res.data),
    enabled: !!foreignTableId,
  });

  const { data: selfFieldVos = [] } = useQuery({
    queryKey: ReactQueryKeys.fieldList(tableIdForContext),
    queryFn: () => getFields(tableIdForContext!).then((res) => res.data),
    enabled: !!tableIdForContext,
  });

  const foreignFieldInstances = useMemo(
    () => totalFields.map((field) => createFieldInstance(field) as IFieldInstance),
    [totalFields]
  );

  const selfFieldInstances = useMemo(
    () => selfFieldVos.map((field) => createFieldInstance(field) as IFieldInstance),
    [selfFieldVos]
  );

  const referenceSource = useMemo(() => {
    if (!enableFieldReference) {
      return undefined;
    }
    return { fields: selfFieldInstances, tableId: tableIdForContext };
  }, [enableFieldReference, selfFieldInstances, tableIdForContext]);

  if (!foreignTableId || !foreignFieldInstances.length) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border px-2 py-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-0.5">
            {t('table:field.editor.filter')}
            {required ? <RequireCom /> : null}
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button size={'xs'} variant={'ghost'}>
                <Maximize2 />
              </Button>
            </DialogTrigger>
            <DialogContent className="min-w-96 max-w-fit">
              <FilterWithTable
                fields={foreignFieldInstances}
                value={filter ?? null}
                context={context}
                referenceSource={referenceSource}
                onChange={(value) => onChange?.(value)}
              />
            </DialogContent>
          </Dialog>
        </div>

        <FilterWithTable
          fields={foreignFieldInstances}
          value={filter ?? null}
          context={context}
          referenceSource={referenceSource}
          onChange={(value) => onChange?.(value)}
        />
      </div>
    </div>
  );
};
