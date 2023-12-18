import { getValidStatisticFunc, NoneFunc, statisticFunc2NameMap } from '@teable-group/core';
import type { StatisticsFunc } from '@teable-group/core';
import { useField, useView } from '@teable-group/sdk/hooks';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable-group/ui-lib/shadcn';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { useGridViewStore } from '../store/gridView';

export const StatisticMenu = () => {
  const view = useView();
  const { statisticMenu, closeStatisticMenu } = useGridViewStore();
  const { fieldId, position } = statisticMenu || {};
  const visible = Boolean(statisticMenu);
  const style = position
    ? {
        left: position.x + position.width,
        top: position.y + 4,
      }
    : {};

  const field = useField(fieldId);
  const fieldStatisticRef = useRef<HTMLDivElement>(null);

  useClickAway(fieldStatisticRef, () => {
    closeStatisticMenu();
  });

  if (fieldId == null) return null;

  const menuItems = [NoneFunc.None, ...(getValidStatisticFunc(field) || [])];

  const onSelect = (type: NoneFunc | StatisticsFunc) => {
    closeStatisticMenu();
    view &&
      view.setViewColumnMeta([
        {
          fieldId,
          columnMeta: {
            statisticFunc: type === NoneFunc.None ? null : type,
          },
        },
      ]);
  };

  return (
    <Popover open={visible}>
      <PopoverTrigger asChild style={style} className="absolute">
        <div className="h-0 w-0 opacity-0" />
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
  );
};
