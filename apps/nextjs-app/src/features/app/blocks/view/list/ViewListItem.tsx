import { Sheet } from '@teable-group/icons';
import { useTableId } from '@teable-group/sdk/hooks';
import type { IViewInstance } from '@teable-group/sdk/model';
import { Button } from '@teable-group/ui-lib/shadcn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn/ui/dropdown-menu';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import classnames from 'classnames';
import Link from 'next/link';
import { useState } from 'react';
import { useDeleteView } from './useDeleteView';
interface IProps {
  view: IViewInstance;
  removable: boolean;
  isActive: boolean;
}

export const ViewListItem: React.FC<IProps> = ({ view, removable, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const tableId = useTableId();
  const deleteView = useDeleteView(view.id);

  const ViewButton = () => {
    return (
      <Button
        className={classnames('max-w-xs', { 'bg-secondary': isActive })}
        variant="ghost"
        size="xs"
        asChild
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
          <Sheet className="h-4 w-4 mr-2" />
          {view.name}
        </Link>
      </Button>
    );
  };
  return (
    <div className={'flex items-center relative justify-start'}>
      {!isEditing && (
        <>
          <DropdownMenu>
            {isActive ? (
              <DropdownMenuTrigger>
                <ViewButton />
              </DropdownMenuTrigger>
            ) : (
              <ViewButton />
            )}
            <DropdownMenuContent side="bottom" align="start">
              <DropdownMenuItem onSelect={() => setIsEditing(true)}>Rename view</DropdownMenuItem>
              <DropdownMenuItem>Duplicate view</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!removable}
                onSelect={(e) => {
                  e.preventDefault();
                  deleteView();
                }}
              >
                Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {isEditing && (
        <Input
          type="text"
          placeholder="name"
          defaultValue={view.name}
          className="min-w-[150px] h-6 py-0 cursor-text focus-visible:ring-transparent focus-visible:ring-offset-0"
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
