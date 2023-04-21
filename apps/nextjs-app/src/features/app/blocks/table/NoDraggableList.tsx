import { useTableId, useTables } from '@teable-group/sdk';
import classnames from 'classnames';
import { TableListItem } from './TableListItem';

export const NoDraggableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  return (
    <ul className="menu menu-compact" style={{ listStyle: 'none', padding: 0 }}>
      {tables.map((table) => (
        <li
          key={table.id}
          className={classnames('group relative', { bordered: table.id === tableId })}
        >
          <TableListItem table={table} isActive={table.id === tableId} />
        </li>
      ))}
    </ul>
  );
};
