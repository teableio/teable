import type { Table } from '@teable-group/sdk/model';
import classnames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';
import { DeleteTable } from './DeleteTable';

interface IProps {
  table: Table;
  isActive: boolean;
}

export const TableListItem: React.FC<IProps> = ({ table, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <li className={classnames('group relative', { bordered: isActive })}>
      <DeleteTable
        className="hidden group-hover:inline-block absolute right-0 px-2 border-l"
        tableId={table.id}
      />
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
        {table.icon}
        {' ' + table.name}
      </Link>
      {isEditing && (
        <input
          type="text"
          placeholder="name"
          defaultValue={table.name}
          className="input input-bordered input-xs w-full cursor-text bg-base-100 absolute h-full px-4"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onBlur={(e) => {
            if (e.target.value && e.target.value !== table.name) {
              table.updateName(e.target.value);
            }
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== table.name) {
                table.updateName(e.currentTarget.value);
              }
              setIsEditing(false);
            }
          }}
        />
      )}
    </li>
  );
};
