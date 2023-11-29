import { RowHeightLevel } from '@teable-group/core';
import { Menu } from '@teable-group/icons';
import { useMemo } from 'react';
import { ROW_HEIGHT_MENU_ITEMS } from './RowHeightBase';

export const useRowHeightNode = (
  value?: RowHeightLevel | null,
  defaultValue: RowHeightLevel = RowHeightLevel.Short
) => {
  const innerValue = value ?? defaultValue;
  return useMemo(() => {
    return {
      text: innerValue,
      isActive: innerValue !== RowHeightLevel.Short,
      Icon: ROW_HEIGHT_MENU_ITEMS.find((item) => item.value === innerValue)?.Icon || Menu,
    };
  }, [innerValue]);
};
