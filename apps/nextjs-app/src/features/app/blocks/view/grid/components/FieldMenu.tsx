/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { Trash, Edit, EyeOff, ArrowLeft, ArrowRight, FreezeColumn } from '@teable/icons';
import type { GridView } from '@teable/sdk';
import { useFields, useIsTouchDevice, useTablePermission, useView } from '@teable/sdk';
import { insertSingle } from '@teable/sdk/utils';
import {
  cn,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Sheet,
  SheetContent,
  SheetHeader,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useRef } from 'react';
import { useClickAway } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { tableConfig } from '@/features/i18n/table.config';
import { useFieldSettingStore } from '../../field/useFieldSettingStore';
import { useGridViewStore } from '../store/gridView';
import type { IMenuItemProps } from './RecordMenu';

enum MenuItemType {
  Edit = 'Edit',
  Freeze = 'Freeze',
  Hidden = 'Hidden',
  Delete = 'Delete',
  InsertLeft = 'InsertLeft',
  InsertRight = 'InsertRight',
}

const iconClassName = 'mr-2 h-4 w-4';

export const FieldMenu = () => {
  const isTouchDevice = useIsTouchDevice();
  const view = useView() as GridView | undefined;
  const { headerMenu, closeHeaderMenu } = useGridViewStore();
  const { openSetting } = useFieldSettingStore();
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const allFields = useFields({ withHidden: true });
  const fieldSettingRef = useRef<HTMLDivElement>(null);
  const fields = headerMenu?.fields;

  useClickAway(fieldSettingRef, () => {
    closeHeaderMenu();
  });

  if (!view || !fields?.length || !allFields.length) return null;

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
        return view.columnMeta[allFields[index].id].order;
      },
      isInsertAfter
    );

    return openSetting({
      order: newOrder,
      operator: FieldOperator.Insert,
    });
  };

  const freezeField = async () => {
    const fieldId = fieldIds[0];
    const index = allFields.findIndex((f) => f.id === fieldId);

    if (index === -1) return;

    view?.updateFrozenColumnCount(index + 1);
  };

  const menuGroups: IMenuItemProps<MenuItemType>[][] = [
    [
      {
        type: MenuItemType.Edit,
        name: t('table:menu.editField'),
        icon: <Edit className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['field|update'],
        onClick: async () => {
          openSetting({
            fieldId: fieldIds[0],
            operator: FieldOperator.Edit,
          });
        },
      },
    ],
    [
      {
        type: MenuItemType.InsertLeft,
        name: t('table:menu.insertFieldLeft'),
        icon: <ArrowLeft className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['field|create'],
        onClick: async () => await insertField(false),
      },
      {
        type: MenuItemType.InsertRight,
        name: t('table:menu.insertFieldRight'),
        icon: <ArrowRight className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['field|create'],
        onClick: async () => await insertField(),
      },
    ],
    [
      {
        type: MenuItemType.Freeze,
        name: t('table:menu.freezeUpField'),
        icon: <FreezeColumn className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['view|update'],
        onClick: async () => await freezeField(),
      },
    ],
    [
      {
        type: MenuItemType.Hidden,
        name: t('table:menu.hideField'),
        icon: <EyeOff className={iconClassName} />,
        hidden: !permission['view|update'],
        disabled: fields.some((f) => f.isPrimary),
        onClick: async () => {
          const fieldIdsSet = new Set(fieldIds);
          const filteredFields = allFields.filter((f) => fieldIdsSet.has(f.id)).filter(Boolean);
          if (filteredFields.length === 0) return;
          await view.updateColumnMeta(
            filteredFields.map((field) => ({ fieldId: field.id, columnMeta: { hidden: true } }))
          );
        },
      },
      {
        type: MenuItemType.Delete,
        name:
          fieldIds.length > 1
            ? t('table:menu.deleteAllSelectedFields')
            : t('table:menu.deleteField'),
        icon: <Trash className={iconClassName} />,
        hidden: !permission['field|delete'],
        disabled: fields.some((f) => f.isPrimary),
        className: 'text-red-500 aria-selected:text-red-500',
        onClick: async () => {
          const fieldIdsSet = new Set(fieldIds);
          const filteredFields = allFields.filter((f) => fieldIdsSet.has(f.id)).filter(Boolean);
          if (filteredFields.length === 0) return;
          for (const field of filteredFields) {
            await field.delete();
          }
        },
      },
    ],
  ].map((items) => items.filter(({ hidden }) => !hidden));

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={visible} onOpenChange={(open) => !open && closeHeaderMenu()}>
          <SheetContent className="h-5/6 rounded-t-lg py-0" side="bottom">
            <SheetHeader className="h-16 justify-center border-b text-2xl">
              {allFields.find((f) => f.id === fieldIds[0])?.name ?? 'Untitled'}
            </SheetHeader>
            {menuGroups.flat().map(({ type, name, icon, disabled, className, onClick }) => {
              return (
                <div
                  className={cn('flex w-full items-center border-b py-3', className, {
                    'cursor-not-allowed': disabled,
                    'opacity-50': disabled,
                  })}
                  key={type}
                  onSelect={async () => {
                    if (disabled) {
                      return;
                    }
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
          className={cn('absolute rounded-lg shadow-sm w-60 h-auto border', {
            hidden: !visible,
          })}
          style={style}
        >
          <CommandList>
            {menuGroups.map((items, index) => {
              const nextItems = menuGroups[index + 1] ?? [];
              if (!items.length) return null;

              return (
                <Fragment key={index}>
                  <CommandGroup aria-valuetext="name">
                    {items.map(({ type, name, icon, disabled, className, onClick }) => (
                      <CommandItem
                        className={cn('px-4 py-2', className, {
                          'cursor-not-allowed': disabled,
                          'opacity-50': disabled,
                        })}
                        key={type}
                        value={name}
                        onSelect={async () => {
                          if (disabled) {
                            return;
                          }
                          await onClick();
                          closeHeaderMenu();
                        }}
                      >
                        {icon}
                        {name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {nextItems.length > 0 && <CommandSeparator />}
                </Fragment>
              );
            })}
          </CommandList>
        </Command>
      )}
    </>
  );
};
