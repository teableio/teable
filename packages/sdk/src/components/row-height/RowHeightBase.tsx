import type { RowHeightLevel } from '@teable/core';
import { DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from '@teable/ui-lib';
import React from 'react';
import { useTranslation } from '../../context/app/i18n';
import { AdaptiveMenu } from '../adaptive-panel';
import { ReadOnlyTip } from '../ReadOnlyTip';
import { useFieldNameDisplayLinesNodes } from './useFieldNameDisplayLinesNodes';
import { useRowHeightNodes } from './useRowHeightNodes';

interface IRowHeightBaseProps {
  rowHeight?: RowHeightLevel;
  fieldNameDisplayLines?: number;
  onChange?: (type: 'rowHeight' | 'fieldNameDisplayLines', value: RowHeightLevel | number) => void;
  /** Render as a bottom drawer on narrow viewports. Toolbar call sites only. */
  responsive?: boolean;
  children: React.ReactNode;
}

export const RowHeightBase = (props: IRowHeightBaseProps) => {
  const { rowHeight, fieldNameDisplayLines, responsive, children, onChange } = props;

  const { t } = useTranslation();
  const rowHeightMenuItems = useRowHeightNodes();
  const fieldNameDisplayLinesMenuItems = useFieldNameDisplayLinesNodes();

  return (
    <AdaptiveMenu
      responsive={responsive}
      title={t('rowHeight.title')}
      desktopClassName="relative w-52 p-0"
      overlay={<ReadOnlyTip />}
      sections={[
        {
          key: 'rowHeight',
          // No visible label: the drawer heading already says "Row height",
          // and repeating it reads as "Row height / Row height / Short".
          ariaLabel: t('rowHeight.title'),
          value: rowHeight,
          options: rowHeightMenuItems,
          onSelect: (value) => onChange?.('rowHeight', value as RowHeightLevel),
        },
        {
          key: 'fieldNameDisplayLines',
          label: t('fieldNameConfig.title'),
          value: fieldNameDisplayLines,
          options: fieldNameDisplayLinesMenuItems,
          onSelect: (value) => onChange?.('fieldNameDisplayLines', value as number),
        },
      ]}
      desktop={
        <>
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
                <Icon className="pe-1 text-lg" />
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
                <Icon className="pe-1 text-lg" />
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        </>
      }
    >
      {children}
    </AdaptiveMenu>
  );
};
