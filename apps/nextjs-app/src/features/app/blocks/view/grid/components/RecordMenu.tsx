import { Trash, Copy } from '@teable-group/icons';
import { Command, CommandGroup, CommandItem, CommandList } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { useGridViewStore } from '../store/gridView';

enum MenuItemType {
  Delete = 'Delete',
  Copy = 'Copy',
}

const iconClassName = 'mr-2 h-4 w-4';

const menuItems = [
  {
    type: MenuItemType.Copy,
    name: 'Copy cells',
    icon: <Copy className={iconClassName} />,
  },
  {
    type: MenuItemType.Delete,
    name: 'Delete record',
    icon: <Trash className={iconClassName} />,
  },
];

export const RecordMenu = () => {
  const { recordMenu, closeRecordMenu } = useGridViewStore();
  const visible = Boolean(recordMenu);
  const position = recordMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  // const recordIds = recordMenu?.recordIds;
  const recordMenuRef = useRef<HTMLDivElement>(null);

  useClickAway(recordMenuRef, () => {
    closeRecordMenu();
  });

  const onSelect = () => {
    closeRecordMenu();
  };

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
          {menuItems.map(({ type, name, icon }) => (
            <CommandItem className="py-2 px-4" key={type} value={name} onSelect={onSelect}>
              {icon}
              {name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};
