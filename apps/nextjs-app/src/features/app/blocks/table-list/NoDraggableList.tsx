import { useTableId, useTables } from '@teable/sdk';
import { TableListItem } from './TableListItem';
import { useTableHref } from './useTableHref';

export const NoDraggableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();
  const tableHrefMap = useTableHref();

  return (
    <ul>
      {tables.map((table) => (
        <li key={table.id}>
          <TableListItem
            table={table}
            href={tableHrefMap[table.id]}
            isActive={table.id === tableId}
          />
        </li>
      ))}
    </ul>
  );
};
