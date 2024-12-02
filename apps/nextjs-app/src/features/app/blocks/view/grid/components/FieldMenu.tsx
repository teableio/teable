/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import type { IFilter, IGroup, ISort } from '@teable/core';
import { getValidFilterOperators } from '@teable/core';
import {
  Trash2,
  Edit,
  EyeOff,
  ArrowLeft,
  ArrowRight,
  FreezeColumn,
  Filter,
  LayoutList,
  ArrowUpDown,
} from '@teable/icons';
import { deleteFields } from '@teable/openapi';
import type { GridView, IUseFieldPermissionAction } from '@teable/sdk';
import {
  useFields,
  useGridViewStore,
  useIsTouchDevice,
  useTableId,
  useTablePermission,
  useView,
} from '@teable/sdk';
import { TablePermissionContext } from '@teable/sdk/context/table-permission';
import { insertSingle } from '@teable/sdk/utils';

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
  Sheet,
  SheetContent,
  SheetHeader,
} from '@teable/ui-lib/shadcn';
import { merge } from 'lodash';
import { useTranslation } from 'next-i18next';
import { Fragment, useContext, useMemo, useRef } from 'react';
import { useClickAway } from 'react-use';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { tableConfig } from '@/features/i18n/table.config';
import { useFieldSettingStore } from '../../field/useFieldSettingStore';
import { useToolBarStore } from '../../tool-bar/components/useToolBarStore';
import type { IMenuItemProps } from './RecordMenu';

enum MenuItemType {
  Edit = 'Edit',
  Freeze = 'Freeze',
  Hidden = 'Hidden',
  Delete = 'Delete',
  InsertLeft = 'InsertLeft',
  InsertRight = 'InsertRight',
  Sort = 'Sort',
  Filter = 'Filter',
  Group = 'Group',
}

const iconClassName = 'mr-2 h-4 w-4';

export const FieldMenu = () => {
  const isTouchDevice = useIsTouchDevice();
  const view = useView() as GridView | undefined;
  const { filter, sort, group } = view || {};
  const tableId = useTableId();
  const { headerMenu, closeHeaderMenu } = useGridViewStore();
  const { openSetting } = useFieldSettingStore();
  const permission = useTablePermission();
  const fieldsPermission = useContext(TablePermissionContext)?.field.fields;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const allFields = useFields({ withHidden: true, withDenied: true });
  const fieldSettingRef = useRef<HTMLDivElement>(null);
  const { fields, onSelectionClear } = headerMenu ?? {};
  const { filterRef, sortRef, groupRef } = useToolBarStore();

  const menuFieldPermission = useMemo(() => {
    if (!fields?.length || !fieldsPermission) {
      return {};
    }
    let permissions: Partial<Record<IUseFieldPermissionAction, boolean>> =
      fieldsPermission[fields[0].id];
    fields.slice(1).forEach((f) => {
      permissions = merge(
        permissions,
        fieldsPermission[f.id],
        (value1: boolean, value2: boolean) => value1 && value2
      );
    });
    return permissions;
  }, [fields, fieldsPermission]);

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
        hidden: fieldIds.length !== 1 || !menuFieldPermission['field|update'],
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
        type: MenuItemType.Filter,
        name: t('table:menu.filterField'),
        icon: <Filter className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['view|update'],
        onClick: async () => {
          if (!headerMenu) {
            return;
          }
          const { fields } = headerMenu;
          const field = fields.at(0);
          if (!field) {
            return;
          }
          const { id: fieldId } = field;
          const newItem = {
            fieldId,
            operator: getValidFilterOperators(field)?.[0] || null,
            value: null,
          };
          let newFilter = {
            conjunction: 'and',
            filterSet: [newItem],
          } as IFilter;
          if (filter) {
            newFilter = {
              ...filter,
              filterSet: [...filter.filterSet, newItem],
            };
          }
          await view.updateFilter(newFilter);
          filterRef?.current?.click();
        },
      },
      {
        type: MenuItemType.Sort,
        name: t('table:menu.sortField'),
        icon: <ArrowUpDown className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['view|update'],
        onClick: async () => {
          if (!headerMenu) {
            return;
          }
          const { fields } = headerMenu;
          const field = fields.at(0);
          if (!field) {
            return;
          }
          const { id: fieldId } = field;
          const newSortItem = {
            fieldId,
            order: 'asc',
          };
          let newSort = {
            sortObjs: [newSortItem],
          };
          let shouldUpdate = true;
          if (sort) {
            const index = sort.sortObjs.findIndex((f) => f.fieldId === fieldId);
            if (index > -1) {
              shouldUpdate = false;
            }
            newSort = {
              ...sort,
              sortObjs: [...sort.sortObjs, newSortItem],
            };
          }
          shouldUpdate && (await view?.updateSort(newSort as ISort));
          sortRef?.current?.click();
        },
      },
      {
        type: MenuItemType.Group,
        name: t('table:menu.groupField'),
        icon: <LayoutList className={iconClassName} />,
        hidden: fieldIds.length !== 1 || !permission['view|update'],
        onClick: async () => {
          if (!headerMenu) {
            return;
          }
          const { fields } = headerMenu;
          const field = fields.at(0);
          if (!field) {
            return;
          }
          const { id: fieldId } = field;
          const newGroupItem = {
            fieldId,
            order: 'asc',
          };
          let newGroup = [newGroupItem];
          let shouldUpdate = true;
          if (group) {
            const index = group.findIndex((f) => f.fieldId === fieldId);
            if (index > -1) {
              shouldUpdate = false;
            }
            newGroup = [...group, newGroupItem];
          }
          shouldUpdate && (await view.updateGroup(newGroup as IGroup));
          groupRef?.current?.click();
        },
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
        icon: <Trash2 className={iconClassName} />,
        hidden: !menuFieldPermission['field|delete'],
        disabled: fields.some((f) => f.isPrimary),
        className: 'text-red-500 aria-selected:text-red-500',
        onClick: async () => {
          if (!tableId) return;
          const fieldIdsSet = new Set(fieldIds);
          const filteredFields = allFields.filter((f) => fieldIdsSet.has(f.id)).filter(Boolean);
          if (filteredFields.length === 0) return;
          await deleteFields(
            tableId,
            filteredFields.map((f) => f.id)
          );
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
                  onClick={async () => {
                    if (disabled) {
                      return;
                    }
                    await onClick();
                    onSelectionClear?.();
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
        <Popover open={visible}>
          <PopoverTrigger asChild style={style} className="absolute">
            <div className="size-0 opacity-0" />
          </PopoverTrigger>
          <PopoverContent className="h-auto w-60 rounded-md p-0" align="start">
            <Command
              ref={fieldSettingRef}
              className="rounded-md border-none shadow-none"
              style={style}
            >
              <CommandList className="max-h-96">
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
                              onSelectionClear?.();
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
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};
