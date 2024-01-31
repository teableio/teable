import { RowHeightLevel } from '@teable/core';
import { DivideSquare, Menu, Square, StretchHorizontal } from '@teable/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
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
  const { onChange, children } = props;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-40 p-0">
        {ROW_HEIGHT_MENU_ITEMS.map(({ label, value: valueInner, Icon }) => (
          <DropdownMenuItem
            className="cursor-pointer"
            key={valueInner}
            onClick={() => onChange?.(valueInner)}
          >
            <Icon className="pr-1 text-lg" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
