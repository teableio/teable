/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { GridViewOptions } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import { DivideSquare, Menu, Square, StretchHorizontal } from '@teable-group/icons';
import { Popover, PopoverTrigger, PopoverContent } from '@teable-group/ui-lib';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useViewId, useView } from '../../hooks';
import type { GridView } from '../../model';

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

export const RowHeight: React.FC<{
  children: (
    text: string,
    isActive: boolean,
    Icon: React.FC<{ className?: string }>
  ) => React.ReactNode;
}> = ({ children }) => {
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
        {children(rowHeightLevel, rowHeightLevel !== RowHeightLevel.Short, Icon)}
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
