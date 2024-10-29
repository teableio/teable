/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */
import { getValidStatisticFunc, NoneFunc } from '@teable/core';
import type { StatisticsFunc } from '@teable/core';
import { useGridViewStore, useStatisticFunc2NameMap } from '@teable/sdk/components';
import { useField, useIsTouchDevice, useView } from '@teable/sdk/hooks';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

export const StatisticMenu = () => {
  const view = useView();
  const isTouchDevice = useIsTouchDevice();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { statisticMenu, closeStatisticMenu } = useGridViewStore();
  const { fieldId, position } = statisticMenu || {};
  const visible = Boolean(statisticMenu);
  const style = position
    ? {
        left: position.x,
        top: position.y + 4,
        width: position.width,
        height: position.height,
      }
    : {};

  const field = useField(fieldId);
  const fieldStatisticRef = useRef<HTMLDivElement>(null);

  const statisticFunc2NameMap = useStatisticFunc2NameMap();

  useClickAway(fieldStatisticRef, () => {
    closeStatisticMenu();
  });

  if (fieldId == null) return null;

  const menuItems = [NoneFunc.None, ...(getValidStatisticFunc(field) || [])];

  const onSelect = (type: NoneFunc | StatisticsFunc) => {
    closeStatisticMenu();
    view &&
      view.updateColumnMeta([
        {
          fieldId,
          columnMeta: {
            statisticFunc: type === NoneFunc.None ? null : type,
          },
        },
      ]);
  };

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={visible} onOpenChange={(open) => !open && closeStatisticMenu()}>
          <SheetContent className="h-5/6 rounded-t-lg py-0" side="bottom">
            <SheetHeader className="h-16 justify-center border-b text-2xl">
              {t('sdk:common.summary')}
            </SheetHeader>
            {menuItems.map((type) => (
              <div
                key={type}
                className="flex w-full items-center border-b py-3"
                onClick={() => onSelect(type)}
              >
                {statisticFunc2NameMap[type]}
              </div>
            ))}
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={visible}>
          <PopoverTrigger asChild style={style} className="absolute">
            <div className="size-0 opacity-0" />
          </PopoverTrigger>
          <PopoverContent className="h-auto w-[150px] rounded-sm px-0 py-1" align="end">
            <Command ref={fieldStatisticRef} className="rounded-none border-none shadow-none">
              <CommandList>
                <CommandGroup className="p-0" aria-valuetext="name">
                  {menuItems.map((type) => (
                    <CommandItem
                      className="rounded-none p-2 py-1.5 text-[13px]"
                      key={type}
                      value={statisticFunc2NameMap[type]}
                      onSelect={() => onSelect(type)}
                    >
                      {statisticFunc2NameMap[type]}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};
