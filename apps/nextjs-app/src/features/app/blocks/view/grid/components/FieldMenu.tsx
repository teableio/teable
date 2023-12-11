/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { Trash, Edit, EyeOff, ArrowLeft, ArrowRight } from '@teable-group/icons';
import {
  useFields,
  useIsTouchDevice,
  useTablePermission,
  useViewId,
} from '@teable-group/sdk/hooks';
import { insertSingle } from '@teable-group/sdk/utils';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  Sheet,
  SheetContent,
  SheetHeader,
} from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { useGridViewStore } from '../store/gridView';

enum MenuItemType {
  Edit = 'Edit',
  Hidden = 'Hidden',
  Delete = 'Delete',
  InsertLeft = 'InsertLeft',
  InsertRight = 'InsertRight',
}

const iconClassName = 'mr-2 h-4 w-4';

export const FieldMenu = () => {
  const isTouchDevice = useIsTouchDevice();
  const { headerMenu, closeHeaderMenu, openSetting } = useGridViewStore();
  const activeViewId = useViewId();
  const permission = useTablePermission();
  const allFields = useFields({ withHidden: true });
  const fieldSettingRef = useRef<HTMLDivElement>(null);
  const fields = headerMenu?.fields;

  useClickAway(fieldSettingRef, () => {
    closeHeaderMenu();
  });

  if (!activeViewId || !fields?.length || !allFields.length) return null;

  const fieldIds = fields.map((f) => f.id);

  const visible = Boolean(headerMenu);
  const position = headerMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};

  const insertField = async (isInsertAfter: boolean = true) => {
    const fieldId = fieldIds[0];
    const index = allFields.findIndex((f) => f.id === fieldId);

    if (index === -1) return;

    const newOrder = insertSingle(
      index,
      allFields.length,
      (index: number) => {
        return allFields[index].columnMeta[activeViewId].order;
      },
      isInsertAfter
    );

    return openSetting({
      order: newOrder,
      operator: FieldOperator.Insert,
    });
  };

  const menuItems = [
    {
      type: MenuItemType.Edit,
      name: 'Edit field',
      icon: <Edit className={iconClassName} />,
      hidden: fieldIds.length !== 1 || !permission['field|update'],
      onClick: async () => {
        openSetting({
          fieldId: fieldIds[0],
          operator: FieldOperator.Edit,
        });
      },
    },
    {
      type: MenuItemType.InsertLeft,
      name: 'Insert left',
      icon: <ArrowLeft className={iconClassName} />,
      hidden: fieldIds.length !== 1 || !permission['field|create'],
      onClick: async () => await insertField(false),
    },
    {
      type: MenuItemType.InsertRight,
      name: 'Insert right',
      icon: <ArrowRight className={iconClassName} />,
      hidden: fieldIds.length !== 1 || !permission['field|create'],
      onClick: async () => await insertField(),
    },
    {
      type: MenuItemType.Hidden,
      name: 'Hide field',
      icon: <EyeOff className={iconClassName} />,
      hidden: !permission['view|update'],
      onClick: async () => {
        const fieldIdsSet = new Set(fieldIds);
        const filteredFields = allFields.filter((f) => fieldIdsSet.has(f.id)).filter(Boolean);
        if (filteredFields.length === 0) return;
        filteredFields.forEach((field) => field.updateColumnHidden(activeViewId, true));
      },
    },
    {
      type: MenuItemType.Delete,
      name: fieldIds.length > 1 ? 'Delete all selected fields' : 'Delete field',
      icon: <Trash className={iconClassName} />,
      hidden: !permission['field|delete'],
      onClick: async () => {
        const fieldIdsSet = new Set(fieldIds);
        const filteredFields = allFields.filter((f) => fieldIdsSet.has(f.id)).filter(Boolean);
        if (filteredFields.length === 0) return;
        filteredFields.forEach((field) => field.delete());
      },
    },
  ].filter(({ hidden }) => !hidden);

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={visible} onOpenChange={(open) => !open && closeHeaderMenu()}>
          <SheetContent className="h-5/6 rounded-t-lg py-0" side="bottom">
            <SheetHeader className="h-16 justify-center border-b text-2xl">
              {allFields.find((f) => f.id === fieldIds[0])?.name ?? 'Untitled'}
            </SheetHeader>
            {menuItems.map(({ type, name, icon, onClick }) => {
              return (
                <div
                  className="flex w-full items-center border-b py-3"
                  key={type}
                  onSelect={async () => {
                    await onClick();
                    closeHeaderMenu();
                  }}
                >
                  {icon}
                  {name}
                </div>
              );
            })}
          </SheetContent>
        </Sheet>
      ) : (
        <Command
          ref={fieldSettingRef}
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
                    closeHeaderMenu();
                  }}
                >
                  {icon}
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </>
  );
};
