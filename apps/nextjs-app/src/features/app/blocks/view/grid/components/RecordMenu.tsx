import { FieldKeyType } from '@teable/core';
import { Trash, Copy, ArrowUp, ArrowDown } from '@teable/icons';
import { deleteRecords } from '@teable/openapi';
import { SelectionRegionType } from '@teable/sdk/components';
import { useTableId, useTablePermission, useViewId } from '@teable/sdk/hooks';
import { Record } from '@teable/sdk/model';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@teable/ui-lib/shadcn';
import classNames from 'classnames';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';
import { useSelectionOperation } from '../hooks/useSelectionOperation';
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
}

const iconClassName = 'mr-2 h-4 w-4';

export const RecordMenu = () => {
  const { recordMenu, closeRecordMenu, selection } = useGridViewStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const tableId = useTableId();
  const viewId = useViewId();
  const permission = useTablePermission();
  const { copy } = useSelectionOperation();
  const recordMenuRef = useRef<HTMLDivElement>(null);

  useClickAway(recordMenuRef, () => {
    closeRecordMenu();
  });

  if (recordMenu == null) return null;

  const { records, neighborRecords, onAfterInsertCallback } = recordMenu;

  if (!records?.length) return null;

  const visible = Boolean(recordMenu);
  const position = recordMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const onInsertRecord = async (sort: number) => {
    if (!tableId || !viewId) return;

    const res = await Record.createRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {},
          recordOrder: { [viewId]: sort },
        },
      ],
    });
    const record = res.data.records[0];

    if (record == null || selection == null) return;

    const { type, ranges } = selection;

    if (type === SelectionRegionType.Cells) {
      return onAfterInsertCallback?.(record.id, ranges[0][1]);
    }
    if (type === SelectionRegionType.Rows) {
      return onAfterInsertCallback?.(record.id, ranges[0][0]);
    }
  };

  const menuItemGroups: IMenuItemProps<MenuItemType>[][] = [
    [
      {
        type: MenuItemType.InsertAbove,
        name: t('table:menu.insertRecordAbove'),
        icon: <ArrowUp className={iconClassName} />,
        hidden: records.length !== 1 || !permission['record|create'],
        onClick: async () => {
          if (!tableId || !viewId) return;
          let finalSort;
          const [aboveRecord] = neighborRecords;
          const sort = records[0].recordOrder[viewId];

          if (aboveRecord == null) {
            finalSort = sort - 1;
          } else {
            const aboveSort = aboveRecord.recordOrder[viewId];
            finalSort = (sort + aboveSort) / 2;
          }
          await onInsertRecord(finalSort);
        },
      },
      {
        type: MenuItemType.InsertBelow,
        name: t('table:menu.insertRecordBelow'),
        icon: <ArrowDown className={iconClassName} />,
        hidden: records.length !== 1 || !permission['record|create'],
        onClick: async () => {
          if (!tableId || !viewId) return;
          let finalSort;
          const [, blewRecord] = neighborRecords;
          const sort = records[0].recordOrder[viewId];

          if (blewRecord == null) {
            finalSort = sort + 1;
          } else {
            const aboveSort = blewRecord.recordOrder[viewId];
            finalSort = (sort + aboveSort) / 2;
          }
          await onInsertRecord(finalSort);
        },
      },
    ],
    [
      {
        type: MenuItemType.Copy,
        name: t('table:menu.copyCells'),
        icon: <Copy className={iconClassName} />,
        onClick: async () => {
          selection && (await copy(selection));
        },
      },
      {
        type: MenuItemType.Delete,
        name:
          records.length > 1
            ? t('table:menu.deleteAllSelectedRecords')
            : t('table:menu.deleteRecord'),
        icon: <Trash className={iconClassName} />,
        hidden: !permission['record|delete'],
        className: 'text-red-500 aria-selected:text-red-500',
        onClick: async () => {
          const recordIds = records.map((r) => r.id);
          tableId && (await deleteRecords(tableId, recordIds));
        },
      },
    ],
  ].map((items) => (items as IMenuItemProps<MenuItemType>[]).filter(({ hidden }) => !hidden));

  return (
    <Command
      ref={recordMenuRef}
      className={classNames('absolute rounded-sm shadow-sm w-60 h-auto border', {
        hidden: !visible,
      })}
      style={style}
    >
      <CommandList>
        {menuItemGroups.map((items, index) => {
          const nextItems = menuItemGroups[index + 1] ?? [];
          if (!items.length) return null;

          return (
            <>
              <CommandGroup key={`rm-group-${index}`} aria-valuetext="name">
                {items.map(({ type, name, icon, className, onClick }) => (
                  <CommandItem
                    className={classNames('px-4 py-2', className)}
                    key={type}
                    value={name}
                    onSelect={async () => {
                      await onClick();
                      closeRecordMenu();
                    }}
                  >
                    {icon}
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
              {nextItems.length > 0 && <CommandSeparator key={`rm-separator-${index}`} />}
            </>
          );
        })}
      </CommandList>
    </Command>
  );
};
