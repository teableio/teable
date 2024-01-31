import { useTableId, useTablePermission } from '@teable/sdk/hooks';
import type { IViewInstance } from '@teable/sdk/model';
import { Button, Separator, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { Input } from '@teable/ui-lib/shadcn/ui/input';
import classnames from 'classnames';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { VIEW_ICON_MAP } from '../constant';
import { useDeleteView } from './useDeleteView';
interface IProps {
  view: IViewInstance;
  removable: boolean;
  isActive: boolean;
}

export const ViewListItem: React.FC<IProps> = ({ view, removable, isActive }) => {
  const [isEditing, setIsEditing] = useState(false);
  const tableId = useTableId();
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const deleteView = useDeleteView(view.id);
  const permission = useTablePermission();

  const navigateHandler = () => {
    router.push(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: { baseId, tableId: tableId, viewId: view.id },
      },
      undefined,
      { shallow: Boolean(view.id) }
    );
  };
  const ViewIcon = VIEW_ICON_MAP[view.type];

  const showViewMenu =
    permission['view|delete'] || permission['view|update'] || permission['view|create'];

  const commonPart = (
    <div className="flex w-full items-center overflow-hidden px-0.5">
      <ViewIcon className="mr-1 size-4 shrink-0" />
      {!isEditing ? (
        isActive && showViewMenu ? (
          <PopoverTrigger asChild>
            <div className="flex flex-1 items-center justify-center overflow-hidden">
              <div className="truncate text-xs font-medium leading-5">{view.name}</div>
            </div>
          </PopoverTrigger>
        ) : (
          <div className="flex flex-1 items-center justify-center overflow-hidden">
            <div className="truncate text-xs font-medium leading-5">{view.name}</div>
          </div>
        )
      ) : (
        <Input
          type="text"
          placeholder="name"
          defaultValue={view.name}
          className="h-6 cursor-text py-0 text-xs focus-visible:ring-transparent focus-visible:ring-offset-0"
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
            e.stopPropagation();
          }}
        />
      )}
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className={classnames(
        'mx-0.5 flex h-7 w-28 items-center overflow-hidden rounded-md bg-popover p-1 text-sm hover:bg-secondary',
        {
          'bg-secondary': isActive,
        }
      )}
      onDoubleClick={() => {
        permission['view|update'] && setIsEditing(true);
      }}
      onKeyDown={(e) => {
        if (isEditing) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          navigateHandler();
        }
      }}
      onClick={() => {
        if (isEditing) {
          return;
        }
        navigateHandler();
      }}
    >
      <Popover>
        <Button
          variant="ghost"
          size="xs"
          className={classnames('m-0 flex w-full rounded-sm p-0', {
            'bg-secondary': isActive,
          })}
        >
          {commonPart}
        </Button>
        <PopoverContent className="w-32 p-1">
          <div className="flex flex-col">
            {permission['view|update'] && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setIsEditing(true);
                }}
              >
                Rename view
              </Button>
            )}
            {/* {permission['view|create'] && (
                    <Button variant="ghost" size="xs">
                      Duplicate view
                    </Button>
                  )} */}
            {permission['view|delete'] && (
              <>
                <Separator className="my-0.5" />
                <Button
                  size="xs"
                  disabled={!removable}
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    deleteView();
                  }}
                >
                  Delete view
                </Button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
