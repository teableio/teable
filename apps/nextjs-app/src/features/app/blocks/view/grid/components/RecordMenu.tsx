import { Trash2, ArrowUp, ArrowDown, Copy } from '@teable/icons';
import { useGridViewStore } from '@teable/sdk/components';
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
  Input,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { noop } from 'lodash';
import { useTranslation, Trans } from 'next-i18next';
import { Fragment, useCallback, useRef, useState } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

export interface IMenuItemProps<T> {
  type: T;
  name: string;
  icon: React.ReactNode;
  hidden?: boolean;
  disabled?: boolean;
  className?: string;
  render?: React.ReactNode;
  onClick: () => void;
}

interface InsertRecordRender {
  onClick: (num: number) => void;
  icon: React.ReactElement;
  type: MenuItemType.InsertAbove | MenuItemType.InsertBelow;
}

enum MenuItemType {
  Copy = 'Copy',
  Delete = 'Delete',
  InsertAbove = 'InsertAbove',
  InsertBelow = 'InsertBelow',
  Duplicate = 'Duplicate',
}

const iconClassName = 'mr-2 h-4 w-4 shrink-0';

const InsertRecordRender = (props: InsertRecordRender) => {
  const { onClick, icon, type } = props;
  const [num, setNumber] = useState(1);
  const i18nKey =
    type === MenuItemType.InsertAbove
      ? 'table:menu.insertRecordAbove'
      : 'table:menu.insertRecordBelow';
  return (
    <Button
      variant={'ghost'}
      size="sm"
      className="m-0 flex size-full h-5 justify-start gap-0 p-0"
      onClick={() => {
        onClick(num);
      }}
    >
      {icon}
      <div className="flex flex-1 items-center text-sm">
        <Trans
          ns={tableConfig.i18nNamespaces}
          i18nKey={i18nKey}
          components={{
            input: (
              <Input
                className="mx-1 h-6 w-14"
                defaultValue={1}
                onKeyDown={(e) => {
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onChange={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const originValue = Math.abs(Math.round(Number(e.target.value)));
                  const newValue = isNaN(originValue) ? 1 : originValue;
                  if (originValue > 1000) {
                    e.target.value = '1000';
                    setNumber(1000);
                    return;
                  }
                  setNumber(newValue);
                }}
              />
            ),
          }}
        />
      </div>
    </Button>
  );
};

export const RecordMenu = () => {
  const { recordMenu, closeRecordMenu } = useGridViewStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const tableId = useTableId();
  const view = useView();
  const viewId = view?.id;
  const permission = useTablePermission();
  const recordMenuRef = useRef<HTMLDivElement>(null);

  useClickAway(recordMenuRef, () => {
    closeRecordMenu();
  });

  const insertRecordFn = useCallback(
    (num: number, position: 'before' | 'after') => {
      if (!recordMenu) {
        return null;
      }
      const { record, insertRecord } = recordMenu;
      if (!tableId || !viewId || !record) return;
      insertRecord?.(record.id, position, num);
    },
    [recordMenu, tableId, viewId]
  );

  if (recordMenu == null) return null;

  const { record, isMultipleSelected } = recordMenu;

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
        render: (
          <InsertRecordRender
            onClick={(num: number) => insertRecordFn(num, 'before')}
            icon={<ArrowUp className={iconClassName} />}
            type={MenuItemType.InsertAbove}
          />
        ),
        onClick: async () => {
          noop();
        },
      },
      {
        type: MenuItemType.InsertBelow,
        name: t('table:menu.insertRecordBelow'),
        icon: <ArrowDown className={iconClassName} />,
        hidden: isMultipleSelected || !permission['record|create'],
        disabled: isAutoSort,
        render: (
          <InsertRecordRender
            onClick={(num: number) => insertRecordFn(num, 'after')}
            icon={<ArrowDown className={iconClassName} />}
            type={MenuItemType.InsertBelow}
          />
        ),
        onClick: async () => {
          noop();
        },
      },
    ],
    [
      {
        type: MenuItemType.Duplicate,
        name: t('sdk:expandRecord.duplicateRecord'),
        icon: <Copy className={iconClassName} />,
        hidden: isMultipleSelected || !permission['record|create'],
        onClick: async () => {
          if (tableId && recordMenu?.duplicateRecord) {
            await recordMenu.duplicateRecord();
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
        icon: <Trash2 className={iconClassName} />,
        hidden: !permission['record|delete'],
        className: 'text-red-500 aria-selected:text-red-500',
        onClick: async () => {
          if (recordMenu && tableId && recordMenu.deleteRecords) {
            await recordMenu.deleteRecords();
          }
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
      <PopoverContent className="h-auto w-60 rounded-md p-0" align="start">
        <Command ref={recordMenuRef} className="rounded-md border-none shadow-none" style={style}>
          <CommandList>
            {menuItemGroups.map((items, index) => {
              const nextItems = menuItemGroups[index + 1] ?? [];
              if (!items.length) return null;

              return (
                <Fragment key={index}>
                  <CommandGroup aria-valuetext="name">
                    {items.map(({ type, name, icon, className, disabled, onClick, render }) => {
                      return (
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
                                  <div className="pointer-events-none">
                                    {render ? (
                                      render
                                    ) : (
                                      <>
                                        {icon}
                                        {name}
                                      </>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent hideWhenDetached={true}>
                                  {t('table:view.insertToolTip')}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <>
                              {render ? (
                                render
                              ) : (
                                <>
                                  {icon}
                                  {name}
                                </>
                              )}
                            </>
                          )}
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
