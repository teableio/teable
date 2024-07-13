import type { RowHeightLevel } from '@teable/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import React from 'react';
import { useRowHeightNodes } from './useRowHeightNodes';

interface IRowHeightBaseProps {
  value?: RowHeightLevel;
  onChange?: (value: RowHeightLevel) => void;
  children: React.ReactNode;
}

export const RowHeightBase = (props: IRowHeightBaseProps) => {
  const { onChange, children } = props;

  const rowHeightMenuItems = useRowHeightNodes();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-40 p-0">
        {rowHeightMenuItems.map(({ label, value: valueInner, Icon }) => (
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
