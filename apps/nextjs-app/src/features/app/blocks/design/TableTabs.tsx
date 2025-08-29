import { Table2 } from '@teable/icons';
import { AnchorContext, FieldProvider, TablePermissionProvider } from '@teable/sdk/context';
import { useTables } from '@teable/sdk/hooks';
import { Selector } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Tabs,
  TabsContent,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { DynamicBaseErd } from '../erd/DynamicBaseErd';
import { FieldSetting } from '../view/field/FieldSetting';
import { DataTable } from './data-table/DataTable';
import { TableDetail } from './TableDetail';

const BaseErdialog = ({ baseId }: { baseId: string }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">ERD</Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-w-7xl p-0"
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
      >
        <DynamicBaseErd baseId={baseId} />
      </DialogContent>
    </Dialog>
  );
};

const TablePicker = ({
  tableId,
  readonly,
  onChange,
}: {
  tableId: string;
  readonly: boolean;
  onChange: (tableId: string) => void;
}) => {
  const { t } = useTranslation(['table']);
  let tables = useTables() as { id: string; name: string; icon?: string }[];

  if (tableId && !tables.find((table) => table.id === tableId)) {
    tables = tables.concat({
      id: tableId!,
      name: t('table:field.editor.tableNoPermission'),
    });
  }

  return (
    <Selector
      className="w-[200px]"
      readonly={readonly}
      selectedId={tableId}
      onChange={(tableId) => onChange?.(tableId)}
      candidates={tables.map((table) => ({
        id: table.id,
        name: table.name,
        icon: table.icon || <Table2 className="size-4 shrink-0" />,
      }))}
      placeholder={t('table:field.editor.selectTable')}
    />
  );
};

export const TableTabs = () => {
  const tables = useTables();
  const router = useRouter();
  const tableId = router.query.tableId as string;
  const baseId = router.query.baseId as string;

  return (
    <Tabs
      value={tableId}
      onValueChange={(tableId) =>
        router.push({ pathname: router.pathname, query: { ...router.query, tableId } })
      }
      className="space-y-4"
    >
      <div className="flex items-center gap-2">
        <TablePicker
          tableId={tableId}
          readonly={false}
          onChange={(tableId) =>
            router.push({ pathname: router.pathname, query: { ...router.query, tableId } })
          }
        />
        <BaseErdialog baseId={baseId} />
      </div>

      {tables.map((table) => (
        <AnchorContext.Provider key={table.id} value={{ baseId, tableId: table.id }}>
          <TablePermissionProvider baseId={baseId}>
            <TabsContent value={table.id} className="space-y-4">
              {/* Table Details */}
              <TableDetail />

              {/* Fields Table */}
              <div className="overflow-x-auto rounded-md border">
                <FieldProvider>
                  <DataTable />
                  <FieldSetting />
                </FieldProvider>
              </div>
            </TabsContent>
          </TablePermissionProvider>
        </AnchorContext.Provider>
      ))}
    </Tabs>
  );
};
