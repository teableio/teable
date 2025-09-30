import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Database, Table2 } from '@teable/icons';
import { getBaseAll } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { AnchorContext, TableProvider } from '@teable/sdk/context';
import { useBaseId, useTableId, useTables } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Selector } from '@/components/Selector';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';

interface ISelectTableProps {
  baseId?: string;
  tableId?: string;
  onChange?: (baseId?: string, tableId?: string) => void;
}

export const SelectTable = ({ baseId, tableId, onChange }: ISelectTableProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [enableSelectBase, setEnableSelectBase] = useState(Boolean(baseId));
  const selfTableId = useTableId();
  const selfBaseId = useBaseId();
  const selectedBaseId = baseId || selfBaseId!;

  return (
    <div className="flex flex-col gap-4">
      {enableSelectBase && (
        <>
          <div className="flex w-full flex-col gap-2">
            <div className="neutral-content label-text flex h-5 items-center justify-between">
              {t('table:field.editor.linkBase')}
              <Button
                size="xs"
                variant="link"
                onClick={() => {
                  setEnableSelectBase(false);
                  onChange?.(undefined, undefined);
                }}
                className="h-5 text-xs text-muted-foreground decoration-muted-foreground"
              >
                {t('common:actions.cancel')}
              </Button>
            </div>
            <BasePicker
              baseId={selectedBaseId}
              onChange={(baseId) => {
                if (baseId === selfBaseId) {
                  onChange?.(undefined, undefined);
                } else {
                  onChange?.(baseId);
                }
              }}
            />
          </div>
        </>
      )}
      <AnchorContext.Provider value={{ baseId: selectedBaseId }}>
        <div className="flex w-full flex-col gap-2">
          <div className="neutral-content flex h-5 items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-1 ">
              {t('table:field.editor.linkTable')}
              <RequireCom />
              {tableId && (
                <Link href={`/base/${selectedBaseId}/${tableId}`} target="_blank">
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              )}
            </span>
            {!enableSelectBase && (
              <Button
                size="xs"
                variant="link"
                onClick={() => setEnableSelectBase(true)}
                className="h-5 text-xs text-muted-foreground decoration-muted-foreground hover:underline"
              >
                {t('table:field.editor.linkFromExternalBase')}
              </Button>
            )}
          </div>
          <TableProvider>
            <TablePicker
              tableId={tableId}
              selfTableId={selfTableId}
              onChange={(tableId) => onChange?.(baseId!, tableId)}
            />
          </TableProvider>
        </div>
      </AnchorContext.Provider>
    </div>
  );
};

interface ITablePickerProps {
  tableId: string | undefined;
  readonly?: boolean;
  selfTableId?: string;
  onChange?: (tableId: string) => void;
}

const TablePicker = ({ tableId, selfTableId, readonly, onChange }: ITablePickerProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  let tables = useTables() as { id: string; name: string; icon?: string }[];

  if (tableId && !tables.find((table) => table.id === tableId)) {
    tables = tables.concat({
      id: tableId!,
      name: t('table:field.editor.tableNoPermission'),
    });
  }

  return (
    <Selector
      className="w-full"
      readonly={readonly}
      selectedId={tableId}
      onChange={(tableId) => onChange?.(tableId)}
      candidates={tables.map((table) => ({
        id: table.id,
        name: table.name + (selfTableId === table.id ? ` (${t('table:field.editor.self')})` : ''),
        icon: table.icon || <Table2 className="size-4 shrink-0" />,
      }))}
      placeholder={t('table:field.editor.selectTable')}
    />
  );
};

interface IBasePickerProps {
  baseId: string;
  readonly?: boolean;
  onChange?: (baseId: string) => void;
}

const BasePicker = ({ baseId, onChange }: IBasePickerProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  let { data: bases } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () =>
      getBaseAll().then((data) => data.data) as Promise<
        { id: string; name: string; icon?: string }[]
      >,
  });

  if (baseId && !bases?.find((base) => base.id === baseId)) {
    bases = bases?.concat({
      id: baseId!,
      name: t('table:field.editor.baseNoPermission'),
    });
  }

  return (
    <Selector
      className="w-full"
      selectedId={baseId}
      onChange={(baseId) => onChange?.(baseId)}
      candidates={bases?.map((base) => ({
        id: base.id,
        name: base.name,
        icon: base.icon || <Database className="size-4 shrink-0" />,
      }))}
      placeholder={t('table:field.editor.selectBase')}
    />
  );
};
