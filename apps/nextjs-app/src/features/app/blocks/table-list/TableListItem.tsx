import { Table2 } from '@teable-group/icons';
import type { Table } from '@teable-group/sdk/model';
import { Button } from '@teable-group/ui-lib/shadcn';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import classNames from 'classnames';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { DeleteTable } from './DeleteTable';

interface IProps {
  table: Table;
  isActive: boolean;
}

export const TableListItem: React.FC<IProps> = ({ table, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const router = useRouter();
  const viewId = router.query.viewId;
  return (
    <>
      <Button
        variant={'ghost'}
        size={'xs'}
        asChild
        className={classNames(
          'my-[2px] w-full px-2 justify-start text-sm font-normal gap-2 group',
          {
            'bg-secondary': isActive,
          }
        )}
      >
        <Link
          href={{
            pathname: '/space/[tableId]/[viewId]',
            query: { tableId: table.id, viewId: table.defaultViewId },
          }}
          title={table.name}
          // when switch between tables, page will not change we should just do shallow routing
          shallow={Boolean(viewId)}
          onDoubleClick={() => {
            setIsEditing(true);
          }}
          onClick={(e) => {
            if (isActive) {
              e.preventDefault();
            }
          }}
        >
          {table.icon || <Table2 className="w-4 h-4" />}
          <p className="grow">{' ' + table.name}</p>
          <DeleteTable tableId={table.id} className="w-4 h-4 hidden group-hover:block" />
        </Link>
      </Button>
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
    </>
  );
};
