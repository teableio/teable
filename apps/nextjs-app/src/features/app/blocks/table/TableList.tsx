import { useTableId, useTables } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import { TableListItem } from './TableListItem';

export const TableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  return (
    <div className="py-2">
      <div className="mx-2">
        <button className="btn btn-xs btn-ghost btn-block">
          <AddBoldIcon />
          <span className="ml-1">Table</span>
        </button>
      </div>
      <ul className="menu menu-compact">
        {tables.map((table) => (
          <TableListItem key={table.id} table={table} isActive={table.id === tableId} />
        ))}
      </ul>
    </div>
  );
};
