import { Table2 } from '@teable/icons';
import type { Table } from '@teable/sdk/model';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Input } from '@teable/ui-lib/shadcn/ui/input';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { useClickAway } from 'react-use';
import { Emoji } from '../../components/emoji/Emoji';
import { EmojiPicker } from '../../components/emoji/EmojiPicker';
import { TableOperation } from './TableOperation';

interface IProps {
  table: Table;
  isActive: boolean;
  isDragging?: boolean;
  className?: string;
  open?: boolean;
}

export const TableListItem: React.FC<IProps> = ({ table, isActive, className, isDragging }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { baseId } = router.query;
  const viewId = router.query.viewId;

  const navigateHandler = () => {
    router.push(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: {
          tableId: table.id,
          viewId: table.defaultViewId,
          baseId: baseId as string,
        },
      },
      undefined,
      { shallow: Boolean(table.defaultViewId) && Boolean(viewId) }
    );
  };

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.focus());
    }
  }, [isEditing]);

  useClickAway(inputRef, () => {
    if (isEditing && inputRef.current?.value && inputRef.current.value !== table.name)
      table.updateName(inputRef.current.value);
    setIsEditing(false);
  });

  return (
    <>
      <Button
        variant={'ghost'}
        size={'xs'}
        asChild
        className={cn(
          'my-[2px] w-full px-2 justify-start text-sm font-normal gap-2 group bg-popover',
          className,
          {
            'bg-secondary/90': isActive,
          }
        )}
        onClick={navigateHandler}
        onContextMenu={() => setOpen(true)}
      >
        <div>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div onClick={(e) => e.stopPropagation()}>
            <EmojiPicker
              className="flex size-5 items-center justify-center hover:bg-muted-foreground/60"
              onChange={(icon: string) => table.updateIcon(icon)}
              disabled={!table.permission?.['table|update']}
            >
              {table.icon ? (
                <Emoji emoji={table.icon} size={'1rem'} />
              ) : (
                <Table2 className="size-4 shrink-0" />
              )}
            </EmojiPicker>
          </div>
          <p
            className="grow truncate"
            onDoubleClick={() => {
              table.permission?.['table|update'] && setIsEditing(true);
            }}
          >
            {' ' + table.name}
          </p>
          {!isDragging && (
            <TableOperation
              table={table}
              className="size-4 shrink-0 sm:opacity-0 sm:group-hover:opacity-100"
              onRename={() => setIsEditing(true)}
              open={open}
              setOpen={setOpen}
            />
          )}
        </div>
      </Button>
      {isEditing && (
        <Input
          ref={inputRef}
          type="text"
          placeholder="name"
          defaultValue={table.name}
          style={{
            boxShadow: 'none',
          }}
          className="round-none absolute left-0 top-0 size-full cursor-text bg-background px-4 outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== table.name) {
                table.updateName(e.currentTarget.value);
              }
              setIsEditing(false);
            }
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        />
      )}
    </>
  );
};
