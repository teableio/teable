import { useTableId, useTables } from '@teable/sdk';
import { TableListItem } from './TableListItem';

export const NoDraggableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  return (
    <ul>
      {tables.map((table) => (
        <li key={table.id}>
          <TableListItem table={table} isActive={table.id === tableId} />
        </li>
      ))}
    </ul>
  );
};
