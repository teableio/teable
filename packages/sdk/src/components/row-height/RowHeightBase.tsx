import type { RowHeightLevel } from '@teable/core';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import React from 'react';
import { useTranslation } from '../../context/app/i18n';
import { ReadOnlyTip } from '../ReadOnlyTip';
import { useFieldNameDisplayLinesNodes } from './useFieldNameDisplayLinesNodes';
import { useRowHeightNodes } from './useRowHeightNodes';

interface IRowHeightBaseProps {
  rowHeight?: RowHeightLevel;
  fieldNameDisplayLines?: number;
  onChange?: (type: 'rowHeight' | 'fieldNameDisplayLines', value: RowHeightLevel | number) => void;
  children: React.ReactNode;
}

export const RowHeightBase = (props: IRowHeightBaseProps) => {
  const { rowHeight, fieldNameDisplayLines, children, onChange } = props;

  const { t } = useTranslation();
  const rowHeightMenuItems = useRowHeightNodes();
  const fieldNameDisplayLinesMenuItems = useFieldNameDisplayLinesNodes();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="relative w-52 p-0">
        <ReadOnlyTip />
        <DropdownMenuLabel className="px-4 py-2 text-xs font-normal text-muted-foreground">
          {t('rowHeight.title')}
        </DropdownMenuLabel>
        <div className="flex flex-col px-2">
          {rowHeightMenuItems.map(({ label, value: valueInner, Icon }) => (
            <DropdownMenuCheckboxItem
              className="cursor-pointer rounded-md hover:bg-accent"
              key={valueInner}
              checked={rowHeight === valueInner}
              onClick={() => onChange?.('rowHeight', valueInner)}
            >
              <Icon className="pr-1 text-lg" />
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-4 py-2 text-xs font-normal text-muted-foreground">
          {t('fieldNameConfig.title')}
        </DropdownMenuLabel>
        <div className="flex flex-col px-2">
          {fieldNameDisplayLinesMenuItems.map(({ label, value: valueInner, Icon }) => (
            <DropdownMenuCheckboxItem
              className="cursor-pointer rounded-md hover:bg-accent"
              key={valueInner}
              checked={fieldNameDisplayLines === valueInner}
              onClick={() => onChange?.('fieldNameDisplayLines', valueInner)}
            >
              <Icon className="pr-1 text-lg" />
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
