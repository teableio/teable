import { Table2 } from '@teable-group/icons';
import type { Table } from '@teable-group/sdk/model';
import { Button } from '@teable-group/ui-lib/shadcn';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { EmojiPicker } from '../../components/EmojiPicker';
import { DeleteTable } from './DeleteTable';

interface IProps {
  table: Table;
  isActive: boolean;
  className?: string;
}

export const TableListItem: React.FC<IProps> = ({ table, isActive, className }) => {
  const [isEditing, setIsEditing] = useState(false);
  const router = useRouter();
  const { baseId } = router.query;
  const viewId = router.query.viewId;
  const navigateHandler = () => {
    router.push(
      {
        pathname: '/base/[baseId]/[nodeId]/[viewId]',
        query: {
          nodeId: table.id,
          viewId: table.defaultViewId,
          baseId: baseId as string,
        },
      },
      undefined,
      { shallow: Boolean(viewId) }
    );
  };
  return (
    <>
      <Button
        variant={'ghost'}
        size={'xs'}
        asChild
        className={classNames(
          'my-[2px] w-full px-2 justify-start text-sm font-normal gap-2 group',
          className,
          {
            'bg-secondary/90': isActive,
          }
        )}
        onClick={navigateHandler}
        onDoubleClick={() => {
          setIsEditing(true);
        }}
      >
        <div>
          <EmojiPicker
            className="flex h-5 w-5 items-center justify-center hover:bg-muted-foreground/50"
            onChange={(icon: string) => table.updateIcon(icon)}
          >
            {table.icon ? (
              <div className="text-base leading-none">{table.icon}</div>
            ) : (
              <Table2 className="h-4 w-4 shrink-0" />
            )}
          </EmojiPicker>
          <p className="grow truncate">{' ' + table.name}</p>
          <DeleteTable
            tableId={table.id}
            className="h-4 w-4 shrink-0 sm:hidden sm:group-hover:block"
          />
        </div>
      </Button>
      {isEditing && (
        <Input
          type="text"
          placeholder="name"
          defaultValue={table.name}
          style={{
            boxShadow: 'none',
          }}
          className="round-none absolute left-0 top-0 h-full w-full cursor-text bg-background px-4 outline-none"
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
