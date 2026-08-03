/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { Expand, ExpandAll } from '@teable/icons';
import type { GridView } from '@teable/sdk';
import {
  generateLocalId,
  useGridCollapsedGroup,
  useGridViewStore,
  useIsTouchDevice,
  useTableId,
  useView,
} from '@teable/sdk';
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
import { useTranslation } from 'next-i18next';
import { Fragment, useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';
import type { IMenuItemProps } from './RecordMenu';

enum MenuItemType {
  ToggleCollapse = 'ToggleCollapse',
  ExpandAll = 'ExpandAll',
  CollapseAll = 'CollapseAll',
}

const iconClassName = 'mr-2 h-4 w-4';

export const GroupHeaderMenu = () => {
  const isTouchDevice = useIsTouchDevice();
  const tableId = useTableId();
  const view = useView() as GridView | undefined;
  const { groupHeaderMenu, closeGroupHeaderMenu } = useGridViewStore();
  const { collapsedGroupIds, onCollapsedGroupChanged } = useGridCollapsedGroup(
    generateLocalId(tableId, view?.id)
  );
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fieldSettingRef = useRef<HTMLDivElement>(null);
  const { groupId, allGroupHeaderRefs } = groupHeaderMenu ?? {};

  useClickAway(fieldSettingRef, () => {
    closeGroupHeaderMenu();
  });

  if (!view || !groupId) return null;

  const visible = Boolean(groupHeaderMenu);
  const position = groupHeaderMenu?.position;
  const style = position
    ? {
        left: position.x,
        top: position.y,
      }
    : {};
  const isGroupCollapsed = collapsedGroupIds?.has(groupId);

  const menuGroups: IMenuItemProps<MenuItemType>[][] = [
    [
      {
        type: MenuItemType.ToggleCollapse,
        name: isGroupCollapsed ? t('table:menu.expandGroup') : t('table:menu.collapseGroup'),
        icon: <Expand className={cn(iconClassName, !isGroupCollapsed && '-rotate-90')} />,
        hidden: false,
        onClick: async () => {
          if (!allGroupHeaderRefs) return;

          let groupDepth = -1;
          const subGroupIdSet = new Set<string>();

          for (const groupHeaderRef of allGroupHeaderRefs) {
            if (groupDepth !== -1 && groupHeaderRef.depth <= groupDepth) break;
            if (groupHeaderRef.id === groupId) {
              groupDepth = groupHeaderRef.depth;
            }
            if (groupDepth !== -1 && groupHeaderRef.depth > groupDepth) {
              subGroupIdSet.add(groupHeaderRef.id);
            }
          }

          const newCollapsedGroupIds = new Set(collapsedGroupIds);
          const needChangingGroupIds = [groupId, ...subGroupIdSet];

          needChangingGroupIds.forEach((id) =>
            isGroupCollapsed ? newCollapsedGroupIds.delete(id) : newCollapsedGroupIds.add(id)
          );
          onCollapsedGroupChanged?.(newCollapsedGroupIds);
        },
      },
      {
        type: MenuItemType.ExpandAll,
        name: t('table:menu.expandAllGroups'),
        icon: <ExpandAll className={iconClassName} />,
        hidden: false,
        onClick: async () => {
          if (!allGroupHeaderRefs) return;

          onCollapsedGroupChanged?.(new Set());
        },
      },
      {
        type: MenuItemType.CollapseAll,
        name: t('table:menu.collapseAllGroups'),
        icon: <ExpandAll className={cn(iconClassName, '-rotate-90')} />,
        hidden: false,
        onClick: async () => {
          if (!allGroupHeaderRefs) return;

          const allGroupHeaderIds = allGroupHeaderRefs.map((groupHeaderRef) => groupHeaderRef.id);
          onCollapsedGroupChanged?.(new Set(allGroupHeaderIds));
        },
      },
    ],
  ]
    .map((items) => items.filter(({ hidden }) => !hidden))
    .filter((items) => items.length);

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={visible} onOpenChange={(open) => !open && closeGroupHeaderMenu()}>
          <SheetContent className="h-5/6 rounded-t-lg py-0" side="bottom">
            <SheetHeader className="h-16 justify-center border-b text-2xl">
              {t('table:menu.groupMenuTitle')}
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
                    if (disabled) return;
                    await onClick();
                    closeGroupHeaderMenu();
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
              <CommandList className="max-h-[410px]">
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
                              if (disabled) return;
                              await onClick();
                              closeGroupHeaderMenu();
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
