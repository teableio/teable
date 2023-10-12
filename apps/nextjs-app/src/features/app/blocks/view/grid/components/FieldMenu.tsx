import { Trash, Edit, EyeOff } from '@teable-group/icons';
import { useFields, useViewId } from '@teable-group/sdk/hooks';
import { Command, CommandGroup, CommandItem, CommandList } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useGridViewStore } from '../store/gridView';

enum MenuItemType {
  Edit = 'Edit',
  Hidden = 'Hidden',
  Delete = 'Delete',
}

const iconClassName = 'mr-2 h-4 w-4';

export const FieldMenu = () => {
  const { headerMenu, closeHeaderMenu, openSetting } = useGridViewStore();
  const visible = Boolean(headerMenu);
  const position = headerMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const fields = useFields();
  const activeViewId = useViewId();
  const fieldIds = headerMenu?.fields.map((f) => f.id);
  const fieldSettingRef = useRef<HTMLDivElement>(null);

  useClickAway(fieldSettingRef, () => {
    closeHeaderMenu();
  });

  if (fieldIds == null) return null;

  const onSelect = (type: MenuItemType) => {
    closeHeaderMenu();

    if (!fields.length) return;

    const fieldIdsSet = new Set(fieldIds);
    const filteredFields = fields.filter((f) => fieldIdsSet.has(f.id)).filter(Boolean);

    if (filteredFields.length === 0) return;

    if (type === MenuItemType.Delete) {
      return filteredFields.forEach((field) => field.delete());
    }

    if (type === MenuItemType.Edit) {
      return openSetting({
        fieldId: fieldIds[0],
        operator: FieldOperator.Edit,
      });
    }

    if (type === MenuItemType.Hidden) {
      return (
        activeViewId &&
        filteredFields.forEach((field) => field.updateColumnHidden(activeViewId, true))
      );
    }
  };

  const menuItems = [
    {
      type: MenuItemType.Edit,
      name: 'Edit field',
      icon: <Edit className={iconClassName} />,
      filter: () => fieldIds.length === 1,
    },
    {
      type: MenuItemType.Hidden,
      name: 'Hide field',
      icon: <EyeOff className={iconClassName} />,
    },
    {
      type: MenuItemType.Delete,
      name: 'Delete field',
      icon: <Trash className={iconClassName} />,
    },
  ].filter(({ filter }) => (filter ? filter() : true));

  return (
    <Command
      ref={fieldSettingRef}
      className={classNames('absolute rounded-sm shadow-sm w-60 h-auto border', {
        hidden: !visible,
      })}
      style={style}
    >
      <CommandList>
        <CommandGroup className="p-0" aria-valuetext="name">
          {menuItems.map(({ type, name, icon }) => (
            <CommandItem
              className="px-4 py-2"
              key={type}
              value={name}
              onSelect={() => onSelect(type)}
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
