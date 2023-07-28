/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { GridViewOptions } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import { DivideSquare, Menu, Square, StretchHorizontal } from '@teable-group/icons';
import type { GridView } from '@teable-group/sdk';
import { useView, useViewId } from '@teable-group/sdk';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import classNames from 'classnames';
import React, { useMemo } from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
const MENU_ITEMS = [
  {
    label: 'Short',
    value: RowHeightLevel.Short,
    Icon: Menu,
  },
  {
    label: 'Medium',
    value: RowHeightLevel.Medium,
    Icon: StretchHorizontal,
  },
  {
    label: 'Tall',
    value: RowHeightLevel.Tall,
    Icon: DivideSquare,
  },
  {
    label: 'ExtraTall',
    value: RowHeightLevel.ExtraTall,
    Icon: Square,
  },
];

export const RowHeightButton = () => {
  const activeViewId = useViewId();
  const view = useView(activeViewId);

  const rowHeightLevel = useMemo(() => {
    if (view == null) return RowHeightLevel.Short;
    return (view.options as GridViewOptions)?.rowHeight || RowHeightLevel.Short;
  }, [view]);

  const onClick = (value: RowHeightLevel) => {
    if (view == null) return;
    (view as GridView).updateRowHeight(value);
  };

  const Icon = MENU_ITEMS.find((item) => item.value === rowHeightLevel)?.Icon || Menu;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={'ghost'}
          size={'xs'}
          className={classNames('font-normal capitalize', {
            'bg-secondary': rowHeightLevel !== RowHeightLevel.Short,
          })}
        >
          <Icon className="text-lg pr-1" />
          {rowHeightLevel}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-40 p-0">
        <div>
          {MENU_ITEMS.map(({ label, value, Icon }) => (
            <div
              className={classNames(
                'flex items-center space-x-2 cursor-pointer hover:bg-accent py-1.5 px-4 text-sm',
                rowHeightLevel === value && 'text-blue-500'
              )}
              key={value}
              onClick={() => onClick(value)}
            >
              <Icon className="text-lg pr-1" />
              {label}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
