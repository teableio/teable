import { Trash, Copy, ArrowUp, ArrowDown } from '@teable-group/icons';
import { deleteRecords } from '@teable-group/openapi';
import { useTable, useTableId, useTablePermission, useViewId } from '@teable-group/sdk/hooks';
import { Command, CommandGroup, CommandItem, CommandList } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { useSelectionOperation } from '../hooks/useSelectionOperation';
import { useGridViewStore } from '../store/gridView';

enum MenuItemType {
  Copy = 'Copy',
  Delete = 'Delete',
  InsertAbove = 'InsertAbove',
  InsertBelow = 'InsertBelow',
}

const iconClassName = 'mr-2 h-4 w-4';

export const RecordMenu = () => {
  const { recordMenu, closeRecordMenu, selection } = useGridViewStore();
  const table = useTable();
  const tableId = useTableId();
  const viewId = useViewId();
  const permission = useTablePermission();
  const { copy } = useSelectionOperation();
  const recordMenuRef = useRef<HTMLDivElement>(null);

  useClickAway(recordMenuRef, () => {
    closeRecordMenu();
  });

  if (recordMenu == null) return null;

  const { records, neighborRecords } = recordMenu;

  if (!records?.length) return null;

  const visible = Boolean(recordMenu);
  const position = recordMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const menuItems = [
    {
      type: MenuItemType.InsertAbove,
      name: 'Insert record above',
      icon: <ArrowUp className={iconClassName} />,
      hidden: records.length !== 1 || !permission['record|create'],
      onClick: async () => {
        if (!viewId) return;
        let finalSort;
        const [aboveRecord] = neighborRecords;
        const sort = records[0].recordOrder[viewId];

        if (aboveRecord == null) {
          finalSort = sort - 1;
        } else {
          const aboveSort = aboveRecord.recordOrder[viewId];
          finalSort = (sort + aboveSort) / 2;
        }

        table && (await table.createRecord({}, { [viewId]: finalSort }));
      },
    },
    {
      type: MenuItemType.InsertBelow,
      name: 'Insert record below',
      icon: <ArrowDown className={iconClassName} />,
      hidden: records.length !== 1 || !permission['record|create'],
      onClick: async () => {
        if (!viewId) return;
        let finalSort;
        const [, blewRecord] = neighborRecords;
        const sort = records[0].recordOrder[viewId];

        if (blewRecord == null) {
          finalSort = sort + 1;
        } else {
          const aboveSort = blewRecord.recordOrder[viewId];
          finalSort = (sort + aboveSort) / 2;
        }

        table && (await table.createRecord({}, { [viewId]: finalSort }));
      },
    },
    {
      type: MenuItemType.Copy,
      name: 'Copy cells',
      icon: <Copy className={iconClassName} />,
      onClick: async () => {
        selection && (await copy(selection));
      },
    },
    {
      type: MenuItemType.Delete,
      name: records.length > 1 ? 'Delete all selected records' : 'Delete record',
      icon: <Trash className={iconClassName} />,
      hidden: !permission['record|delete'],
      onClick: async () => {
        const recordIds = records.map((r) => r.id);
        tableId && (await deleteRecords(tableId, recordIds));
      },
    },
  ].filter(({ hidden }) => !hidden);

  return (
    <Command
      ref={recordMenuRef}
      className={classNames('absolute rounded-sm shadow-sm w-60 h-auto border', {
        hidden: !visible,
      })}
      style={style}
    >
      <CommandList>
        <CommandGroup className="p-0" aria-valuetext="name">
          {menuItems.map(({ type, name, icon, onClick }) => (
            <CommandItem
              className="px-4 py-2"
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
      </CommandList>
    </Command>
  );
};
