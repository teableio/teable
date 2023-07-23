/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { GridViewOptions } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import type { GridView } from '@teable-group/sdk';
import { useView, useViewId } from '@teable-group/sdk';
import RowHeightIcon from '@teable-group/ui-lib/icons/app/row-height.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import classNames from 'classnames';
import React, { useMemo } from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
const MENU_ITEMS = [
  {
    label: 'Short',
    value: RowHeightLevel.Short,
    Icon: RowHeightIcon,
  },
  {
    label: 'Medium',
    value: RowHeightLevel.Medium,
    Icon: RowHeightIcon,
  },
  {
    label: 'Tall',
    value: RowHeightLevel.Tall,
    Icon: RowHeightIcon,
  },
  {
    label: 'ExtraTall',
    value: RowHeightLevel.ExtraTall,
    Icon: RowHeightIcon,
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={'ghost'} size={'xs'} className="font-normal">
          <RowHeightIcon className="text-lg pr-1" />
          Row Height
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
