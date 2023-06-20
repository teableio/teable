import { useTableId } from '@teable-group/sdk/hooks';
import type { View } from '@teable-group/sdk/model';
import ElipsisIcon from '@teable-group/ui-lib/icons/app/elipsis.svg';
import classnames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useDeleteView } from './useDeleteView';

interface IProps {
  view: View;
  isDelete: boolean;
  isActive: boolean;
}

export const ViewListItem: React.FC<IProps> = ({ view, isDelete, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const tableId = useTableId();
  const deleteView = useDeleteView(view.id);

  return (
    <div
      className={classnames(
        'flex p-2 items-center relative justify-start border-b-2 border-transparent hover:border-border  ',
        {
          'text-accent-foreground border-foreground hover:border-foreground': isActive,
          'text-accent-foreground/70 hover:text-accent-foreground': !isActive,
        }
      )}
    >
      {!isEditing && (
        <>
          <div
            className="text-ellipsis overflow-hidden whitespace-nowrap inline-block align-bottom text-base pr-2"
            style={{ maxWidth: 200 }}
          >
            <Link
              href={{
                pathname: '/space/[tableId]/[viewId]',
                query: { tableId: tableId, viewId: view.id },
              }}
              title={view.name}
              onDoubleClick={() => {
                setIsEditing(true);
              }}
              onClick={(e) => {
                if (isActive) {
                  e.preventDefault();
                }
              }}
            >
              {view.name}
            </Link>
          </div>
          <div className="p-0.5 rounded hover:bg-accent">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <ElipsisIcon className="text-lg pr-1 inline-flex rotate-90" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="start">
                <DropdownMenuItem onSelect={() => setIsEditing(true)}>Rename view</DropdownMenuItem>
                <DropdownMenuItem>Duplicate view</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!isDelete}
                  onSelect={(e) => {
                    e.preventDefault();
                    deleteView();
                  }}
                >
                  Delete view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
      {isEditing && (
        <Input
          type="text"
          placeholder="name"
          defaultValue={view.name}
          className="w-full h-6 py-0 cursor-text focus-visible:ring-transparent focus-visible:ring-offset-0"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          onBlur={(e) => {
            if (e.target.value && e.target.value !== view.name) {
              view.updateName(e.target.value);
            }
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.currentTarget.value && e.currentTarget.value !== view.name) {
                view.updateName(e.currentTarget.value);
              }
              setIsEditing(false);
            }
          }}
        />
      )}
    </div>
  );
};
