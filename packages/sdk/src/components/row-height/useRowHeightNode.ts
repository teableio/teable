import { RowHeightLevel } from '@teable/core';
import { Menu } from '@teable/icons';
import { useMemo } from 'react';
import { useRowHeightNodes } from './useRowHeightNodes';

export const useRowHeightNode = (
  value?: RowHeightLevel | null,
  defaultValue: RowHeightLevel = RowHeightLevel.Short
) => {
  const innerValue = value ?? defaultValue;
  const rowHeightMenuItems = useRowHeightNodes();
  return useMemo(() => {
    return {
      text: innerValue,
      isActive: innerValue !== RowHeightLevel.Short,
      Icon: rowHeightMenuItems.find((item) => item.value === innerValue)?.Icon || Menu,
    };
  }, [innerValue, rowHeightMenuItems]);
};
