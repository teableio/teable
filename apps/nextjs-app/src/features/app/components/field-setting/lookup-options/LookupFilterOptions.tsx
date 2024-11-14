import { useQuery } from '@tanstack/react-query';
import type { IFilter } from '@teable/core';
import { Maximize2 } from '@teable/icons';
import { getFields } from '@teable/openapi';
import { FilterWithTable, useFieldFilterLinkContext } from '@teable/sdk/components';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTableId } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { Button, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

interface ILookupFilterOptionsProps {
  fieldId?: string;
  filter?: IFilter | null;
  foreignTableId: string;
  onChange?: (filter: IFilter | null) => void;
}

export const LookupFilterOptions = (props: ILookupFilterOptionsProps) => {
  const { fieldId, foreignTableId, filter, onChange } = props;

  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const currentTableId = useTableId() as string;

  const context = useFieldFilterLinkContext(currentTableId, fieldId, !fieldId);

  const { data: totalFields = [] } = useQuery({
    queryKey: ReactQueryKeys.fieldList(foreignTableId),
    queryFn: () => getFields(foreignTableId).then((res) => res.data),
    enabled: !!foreignTableId,
  });

  if (!foreignTableId || !totalFields.length) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border px-2 py-3">
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
                onChange={(value) => onChange?.(value)}
              />
            </DialogContent>
          </Dialog>
        </div>

        <FilterWithTable
          fields={totalFields as IFieldInstance[]}
          value={filter ?? null}
          context={context}
          onChange={(value) => onChange?.(value)}
        />
      </div>
    </div>
  );
};
