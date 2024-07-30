import type { IFieldVo } from '@teable/core';
import { ArrowLeft, Table2 } from '@teable/icons';
import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import type { Table } from '@teable/sdk';
import { AnchorContext, FieldProvider, useTable, useTablePermission } from '@teable/sdk';
import { TablePermissionProvider } from '@teable/sdk/context/table-permission';
import { Button } from '@teable/ui-lib/shadcn';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
import { DbConnectionPanel } from '../db-connection/Panel';
import { FieldSetting } from '../view/field/FieldSetting';
import { TableDetail } from './card/TableDetail';
import { DataTable } from './data-table/DataTable';
import { useDataColumns } from './data-table/useDataColumns';

export interface IDesignProps {
  fieldServerData: IFieldVo[];
  baseServerData: IGetBaseVo;
  tableServerData: ITableVo[];
}

export const Design: React.FC<IDesignProps> = ({ fieldServerData: fields }) => {
  const router = useRouter();
  const { baseId, tableId } = router.query as { baseId: string; tableId: string };
  const table = useTable() as Table;
  const permission = useTablePermission();
  const columns = useDataColumns();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  return (
    <AnchorContext.Provider value={{ baseId, tableId }}>
      <TablePermissionProvider baseId={baseId}>
        <FieldProvider serverSideData={fields}>
          <Head>
            <title>
              {table.name
                ? `${table.icon ? table.icon + ' ' : ''}${table.name}`
                : 'Teable' + ' - Designing'}
            </title>
          </Head>
          <div className="flex h-full grow basis-[500px] flex-col gap-4 overflow-auto p-4 pt-0">
            <h1 className="flex items-center gap-2 pt-2 text-xl font-bold tracking-tight">
              <Button size="xs" variant="ghost" asChild>
                <Link
                  href={{
                    pathname: '/base/[baseId]/[tableId]',
                    query: { baseId, tableId },
                  }}
                >
                  <ArrowLeft className="size-4" />
                  {t('actions.back')}
                </Link>
              </Button>
              <EmojiPicker
                className="flex size-5 items-center justify-center hover:bg-muted-foreground/60"
                onChange={(icon: string) => table.updateIcon(icon)}
                disabled={!permission['table|update']}
              >
                {table.icon ? (
                  <Emoji emoji={table.icon} size={'1.5rem'} />
                ) : (
                  <Table2 className="size-6 shrink-0" />
                )}
              </EmojiPicker>
              {table.name}
            </h1>
            <div className="grid grid-cols-1 items-start justify-center gap-6 rounded-lg md:grid-cols-2 lg:grid-cols-3 min-[1600px]:grid-cols-4">
              <div className="col-span-1 items-start">
                <TableDetail />
              </div>
              <div className="col-span-1 h-full items-start">
                <DbConnectionPanel />
              </div>
            </div>
            <div>
              <DataTable data={fields} columns={columns} />
            </div>
          </div>
          {<FieldSetting />}
        </FieldProvider>
      </TablePermissionProvider>
    </AnchorContext.Provider>
  );
};
