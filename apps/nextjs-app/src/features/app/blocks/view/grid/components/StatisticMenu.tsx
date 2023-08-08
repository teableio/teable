import { useField } from '@teable-group/sdk/hooks';
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
import { getStatisticsMapByValueType } from '../utils';

export const StatisticMenu = () => {
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
  const cellValueType = field?.cellValueType;
  const fieldStatisticRef = useRef<HTMLDivElement>(null);

  useClickAway(fieldStatisticRef, () => {
    closeStatisticMenu();
  });

  if (fieldId == null) return null;

  const menuItems = getStatisticsMapByValueType(cellValueType);

  const onSelect = (type: string) => {
    closeStatisticMenu();
    console.log('Statistic type: ', type);
  };

  return (
    <Popover open={visible}>
      <PopoverTrigger asChild style={style} className="absolute">
        <div className="w-0 h-0 opacity-0" />
      </PopoverTrigger>
      <PopoverContent className="h-auto w-[150px] px-0 py-1 rounded-sm" align="end">
        <Command ref={fieldStatisticRef} className="shadow-none border-none rounded-none">
          <CommandList>
            <CommandGroup className="p-0" aria-valuetext="name">
              {menuItems.map(({ type, name }) => (
                <CommandItem
                  className="p-2 py-1.5 rounded-none text-[13px]"
                  key={type}
                  value={name}
                  onSelect={() => onSelect(type)}
                >
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
