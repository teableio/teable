import type { Table } from '@teable-group/sdk/model';
import classnames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';

interface IProps {
  table: Table;
  isActive: boolean;
}

export const TableListItem: React.FC<IProps> = ({ table, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  return (
    <li className={classnames({ bordered: isActive })}>
      {!isEditing ? (
        <Link
          href={{
            pathname: '/space/[tableId]',
            query: { tableId: table.id },
          }}
          className="py-1"
          title={table.name}
          onDoubleClick={() => {
            setIsEditing(true);
          }}
          onClick={(e) => {
            if (isActive) {
              e.preventDefault();
            }
          }}
        >
          {table.name}
        </Link>
      ) : (
        <input
          type="text"
          placeholder="name"
          className="input input-bordered input-xs w-full max-w-xs"
          onBlur={(e) => {
            if (e.target.value && e.target.value !== table.name) {
              table.updateName(e.target.value);
              setIsEditing(false);
            }
          }}
        />
      )}
    </li>
  );
};
