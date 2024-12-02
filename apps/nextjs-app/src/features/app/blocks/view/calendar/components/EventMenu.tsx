import { Trash, Copy } from '@teable/icons';
import { deleteRecord, duplicateRecord } from '@teable/openapi';
import { useTableId, useView } from '@teable/sdk/hooks';
import {
  cn,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';
import { useEventMenuStore } from '../hooks';

export interface IMenuItemProps<T> {
  type: T;
  name: string;
  icon: React.ReactNode;
  hidden?: boolean;
  className?: string;
  onClick: () => void;
}

enum MenuItemType {
  Delete = 'Delete',
  Duplicate = 'Duplicate',
}

const iconClassName = 'mr-2 h-4 w-4 shrink-0';

export const EventMenu = () => {
  const { eventMenu, closeEventMenu } = useEventMenuStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const tableId = useTableId();
  const view = useView();
  const viewId = view?.id;
  const recordMenuRef = useRef<HTMLDivElement>(null);

  const { eventId } = eventMenu ?? {};

  useClickAway(recordMenuRef, () => {
    closeEventMenu();
  });

  if (eventMenu == null || !eventId) return null;

  const { permission, position } = eventMenu;
  const visible = Boolean(eventMenu);
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const menuItemGroups: IMenuItemProps<MenuItemType>[][] = [
    [
      {
        type: MenuItemType.Duplicate,
        name: t('sdk:expandRecord.duplicateRecord'),
        icon: <Copy className={iconClassName} />,
        hidden: !permission.eventCreatable,
        onClick: async () => {
          if (!tableId || !viewId) return;
          await duplicateRecord(tableId, eventId, {
            viewId,
            position: 'after',
            anchorId: eventId,
          });
        },
      },
    ],
    [
      {
        type: MenuItemType.Delete,
        name: t('table:menu.deleteRecord'),
        icon: <Trash className={iconClassName} />,
        hidden: !permission.eventDeletable,
        className: 'text-red-500 aria-selected:text-red-500',
        onClick: async () => {
          if (!tableId) return;
          await deleteRecord(tableId, eventId);
        },
      },
    ],
  ].map((items) => (items as IMenuItemProps<MenuItemType>[]).filter(({ hidden }) => !hidden));

  if (menuItemGroups.every((menuItemGroup) => menuItemGroup.length === 0)) {
    return null;
  }

  return (
    <Popover open={visible}>
      <PopoverTrigger asChild style={style} className="absolute">
        <div className="size-0 opacity-0" />
      </PopoverTrigger>
      <PopoverContent className="h-auto w-56 rounded-md p-0" align="start">
        <Command ref={recordMenuRef} className="rounded-md border-none shadow-none" style={style}>
          <CommandList>
            {menuItemGroups.map((items, index) => {
              const nextItems = menuItemGroups[index + 1] ?? [];
              if (!items.length) return null;

              return (
                <Fragment key={index}>
                  <CommandGroup aria-valuetext="name">
                    {items.map(({ type, name, icon, className, onClick }) => {
                      return (
                        <CommandItem
                          className={cn('px-4 py-2', className)}
                          key={type}
                          value={name}
                          onSelect={async () => {
                            onClick();
                            closeEventMenu();
                          }}
                        >
                          {icon}
                          {name}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  {nextItems.length > 0 && <CommandSeparator />}
                </Fragment>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
