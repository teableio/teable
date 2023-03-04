import { useTableId, useTables } from '@teable-group/sdk';
// import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import classnames from 'classnames';
import Link from 'next/link';

export const TableList: React.FC = () => {
  const tables = useTables();
  const tableId = useTableId();

  return (
    <ul className="menu menu-compact py-2">
      {tables.map((table, i) => (
        <li key={i} className={classnames({ bordered: table.id === tableId })}>
          <Link
            href={{
              pathname: '/space/[tableId]',
              query: { tableId: table.id },
            }}
            className="py-1"
          >
            {table.name}
          </Link>
        </li>
      ))}
    </ul>
  );
};
