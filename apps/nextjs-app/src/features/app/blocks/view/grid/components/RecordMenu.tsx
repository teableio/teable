import { Trash, Copy } from '@teable-group/icons';
import { deleteRecords } from '@teable-group/openapi';
import { useTableId } from '@teable-group/sdk/hooks';
import { Command, CommandGroup, CommandItem, CommandList } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useMemo, useRef } from 'react';
import { useClickAway } from 'react-use';
import { useSelectionOperation } from '../hooks/useSelectionOperation';
import { useGridViewStore } from '../store/gridView';

enum MenuItemType {
  Delete = 'Delete',
  Copy = 'Copy',
}

const iconClassName = 'mr-2 h-4 w-4';

export const RecordMenu = () => {
  const { recordMenu, closeRecordMenu, selection } = useGridViewStore();
  const visible = Boolean(recordMenu);
  const position = recordMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const { copy } = useSelectionOperation();
  const recordMenuRef = useRef<HTMLDivElement>(null);
  const tableId = useTableId();

  useClickAway(recordMenuRef, () => {
    closeRecordMenu();
  });

  const onSelect = () => {
    closeRecordMenu();
  };

  const menuItems = useMemo(
    () => [
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
        name: 'Delete record',
        icon: <Trash className={iconClassName} />,
        onClick: async () => {
          tableId &&
            recordMenu?.records &&
            (await deleteRecords(tableId, recordMenu?.records.map((r) => r.id)));
        },
      },
    ],
    [copy, recordMenu?.records, selection, tableId]
  );

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
                onSelect();
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
