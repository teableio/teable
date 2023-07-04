import type { Table } from '@teable-group/sdk/model';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import classNames from 'classnames';
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
    <div
      className={classNames('relative h-8 my-1', {
        'bg-secondary': isActive,
      })}
    >
      {isActive && <div className="w-0.5 h-full bg-primary absolute left-0 top-0"></div>}
      <Link
        href={{
          pathname: '/space/[tableId]',
          query: { tableId: table.id },
        }}
        className="w-full inline-block hover:bg-secondary py-1 px-2 text-sm hover:pr-10"
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
        <Input
          type="text"
          placeholder="name"
          defaultValue={table.name}
          style={{
            boxShadow: 'none',
          }}
          className="round-none outline-none top-0 left-0 w-full cursor-text absolute h-full px-4 bg-background"
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
      <DeleteTable
        className="hidden absolute right-0 top-0 group-hover:inline-block px-2 border-l border-primary rounded-none"
        tableId={table.id}
      />
    </div>
  );
};
