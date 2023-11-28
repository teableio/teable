/* eslint-disable jsx-a11y/no-static-element-interactions,jsx-a11y/click-events-have-key-events */
import type { GridViewOptions } from '@teable-group/core';
import { RowHeightLevel } from '@teable-group/core';
import { Menu } from '@teable-group/icons';
import React, { useMemo } from 'react';
import { useViewId, useView } from '../../hooks';
import type { GridView } from '../../model';
import { ROW_HEIGHT_MENU_ITEMS, RowHeightBase } from './RowHeightBase';

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

  const onChange = (value: RowHeightLevel) => {
    if (view == null) return;
    (view as GridView).updateRowHeight(value);
  };

  const Icon = ROW_HEIGHT_MENU_ITEMS.find((item) => item.value === rowHeightLevel)?.Icon || Menu;
  return (
    <RowHeightBase value={rowHeightLevel} onChange={onChange}>
      {children(rowHeightLevel, rowHeightLevel !== RowHeightLevel.Short, Icon)}
    </RowHeightBase>
  );
};
