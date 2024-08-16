import { Trash, ArrowUp, ArrowDown, Copy } from '@teable/icons';
import { useTableId, useTablePermission, useView } from '@teable/sdk/hooks';
import {
  cn,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';
import { useGridViewStore } from '../store/gridView';

export interface IMenuItemProps<T> {
  type: T;
  name: string;
  icon: React.ReactNode;
  hidden?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

enum MenuItemType {
  Copy = 'Copy',
  Delete = 'Delete',
  InsertAbove = 'InsertAbove',
  InsertBelow = 'InsertBelow',
  Duplicate = 'duplicate',
}

const iconClassName = 'mr-2 h-4 w-4';

export const RecordMenu = () => {
  const { recordMenu, closeRecordMenu, selection } = useGridViewStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const tableId = useTableId();
  const view = useView();
  const viewId = view?.id;
  const permission = useTablePermission();
  const recordMenuRef = useRef<HTMLDivElement>(null);

  useClickAway(recordMenuRef, () => {
    closeRecordMenu();
  });

  if (recordMenu == null) return null;

  const { record, isMultipleSelected, insertRecord } = recordMenu;
  if (!record && !isMultipleSelected) return null;

  const visible = Boolean(recordMenu);
  const position = recordMenu?.position;
  const isAutoSort = Boolean(view?.sort && !view.sort?.manualSort);
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const menuItemGroups: IMenuItemProps<MenuItemType>[][] = [
    [
      {
        type: MenuItemType.InsertAbove,
        name: t('table:menu.insertRecordAbove'),
        icon: <ArrowUp className={iconClassName} />,
        hidden: isMultipleSelected || !permission['record|create'],
        disabled: isAutoSort,
        onClick: async () => {
          if (!tableId || !viewId || !record) return;
          insertRecord?.(record.id, 'before');
        },
      },
      {
        type: MenuItemType.InsertBelow,
        name: t('table:menu.insertRecordBelow'),
        icon: <ArrowDown className={iconClassName} />,
        hidden: isMultipleSelected || !permission['record|create'],
        disabled: isAutoSort,
        onClick: async () => {
          if (!tableId || !viewId || !record) return;
          insertRecord?.(record.id, 'after');
        },
      },
      {
        type: MenuItemType.Duplicate,
        name: t('table:menu.duplicate'),
        icon: <Copy className={iconClassName} />,
        hidden: isMultipleSelected || !permission['record|create'],
        disabled: isAutoSort,
        onClick: async () => {
          if (recordMenu && tableId && recordMenu.duplicateRecords && selection) {
            // console.log("duplicate record",selection);
            recordMenu.duplicateRecords(selection);
          }
        },
      },
    ],
    [
      {
        type: MenuItemType.Delete,
        name: isMultipleSelected
          ? t('table:menu.deleteAllSelectedRecords')
          : t('table:menu.deleteRecord'),
        icon: <Trash className={iconClassName} />,
        hidden: !permission['record|delete'],
        className: 'text-red-500 aria-selected:text-red-500',
        onClick: async () => {
          if (recordMenu && tableId && recordMenu.deleteRecords && selection) {
            await recordMenu.deleteRecords(selection);
          }
        },
      },
    ],
  ].map((items) => (items as IMenuItemProps<MenuItemType>[]).filter(({ hidden }) => !hidden));

  if (menuItemGroups.every((menuItemGroup) => menuItemGroup.length === 0)) {
    return null;
  }

  return (
    <Command
      ref={recordMenuRef}
      className={cn('absolute rounded-sm shadow-sm w-60 h-auto border', {
        hidden: !visible,
      })}
      style={style}
    >
      <CommandList>
        {menuItemGroups.map((items, index) => {
          const nextItems = menuItemGroups[index + 1] ?? [];
          if (!items.length) return null;

          return (
            <Fragment key={index}>
              <CommandGroup aria-valuetext="name">
                {items.map(({ type, name, icon, className, disabled, onClick }) => (
                  <CommandItem
                    className={cn('px-4 py-2', className)}
                    key={type}
                    value={name}
                    onSelect={async () => {
                      if (disabled) {
                        return;
                      }
                      await onClick();
                      closeRecordMenu();
                    }}
                  >
                    {disabled ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            className={cn('flex items-center gap-2', {
                              'opacity-50': disabled,
                            })}
                          >
                            {icon}
                            {name}
                          </TooltipTrigger>
                          <TooltipContent hideWhenDetached={true}>
                            {t('table:view.insertToolTip')}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <>
                        {icon}
                        {name}
                      </>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              {nextItems.length > 0 && <CommandSeparator />}
            </Fragment>
          );
        })}
      </CommandList>
    </Command>
  );
};
