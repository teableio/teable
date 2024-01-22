import type { IFieldVo, ITableVo } from '@teable-group/core';
import { Table2 } from '@teable-group/icons';
import type { IGetBaseVo } from '@teable-group/openapi';
import type { Table } from '@teable-group/sdk';
import { AnchorContext, FieldProvider, useTable, useTablePermission } from '@teable-group/sdk';
import { cn } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTitle } from 'react-use';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
import { TableConnection } from './card/TableConnection';
import { TableDetail } from './card/TableDetail';
import { DataTable } from './data-table/DataTable';
import { useDataColumns } from './data-table/useDataColumns';

export interface IDesignProps {
  fieldServerData: IFieldVo[];
  baseServerData: IGetBaseVo;
  tableServerData: ITableVo[];
}
function CardContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-center [&>div]:w-full', className)} {...props} />
  );
}

export const Design: React.FC<IDesignProps> = ({ fieldServerData: fields }) => {
  const router = useRouter();
  const { tableId } = router.query as { tableId: string };
  const table = useTable() as Table;
  useTitle(
    table.name ? `${table.icon ? table.icon + ' ' : ''}${table.name}` : 'Teable' + ' - Designing'
  );
  const permission = useTablePermission();
  const columns = useDataColumns();

  return (
    <AnchorContext.Provider value={{ tableId }}>
      <FieldProvider serverSideData={fields}>
        <div className="flex h-full grow basis-[500px] flex-col gap-8 overflow-auto p-8 pt-0">
          <h1 className="flex items-center gap-2 py-4 text-xl font-bold tracking-tight">
            <EmojiPicker
              className="flex h-5 w-5 items-center justify-center hover:bg-muted-foreground/60"
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
          <div className="grid grid-cols-1 items-start justify-center gap-6 rounded-lg sm:grid-cols-2 lg:grid-cols-3">
            <div className="items-start gap-6">
              <CardContainer>
                <TableDetail />
              </CardContainer>
            </div>
            <div className="items-start gap-6 ">
              <CardContainer>
                <TableConnection />
              </CardContainer>
            </div>
          </div>
          <div>
            <h2 className="pb-4 text-lg font-semibold leading-none tracking-tight">
              Field Management
            </h2>
            <DataTable data={fields} columns={columns} />
          </div>
        </div>
      </FieldProvider>
    </AnchorContext.Provider>
  );
};
