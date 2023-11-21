/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { RowHeightLevel } from '@teable-group/core';
import { DivideSquare, Menu, Square, StretchHorizontal } from '@teable-group/icons';
import { Popover, PopoverTrigger, PopoverContent } from '@teable-group/ui-lib';
import classNames from 'classnames';
import React from 'react';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ROW_HEIGHT_MENU_ITEMS = [
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

interface IRowHeightBaseProps {
  value?: RowHeightLevel;
  onChange?: (value: RowHeightLevel) => void;
  children: React.ReactNode;
}

export const RowHeightBase = (props: IRowHeightBaseProps) => {
  const { value, onChange, children } = props;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-40 p-0">
        <div>
          {ROW_HEIGHT_MENU_ITEMS.map(({ label, value: valueInner, Icon }) => (
            <div
              className={classNames(
                'flex items-center space-x-2 cursor-pointer hover:bg-accent py-1.5 px-4 text-sm',
                value === valueInner && 'text-blue-500'
              )}
              key={valueInner}
              onClick={() => onChange?.(valueInner)}
            >
              <Icon className="pr-1 text-lg" />
              {label}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
