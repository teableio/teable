import { useTableId, useTables } from '@teable-group/sdk';
// import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import { TableListItem } from './TableListItem';

export const TableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  return (
    <ul className="menu menu-compact py-2">
      {tables.map((table) => (
        <TableListItem key={table.id} table={table} isActive={table.id === tableId} />
      ))}
    </ul>
  );
};
