import type { RowHeightLevel } from '@teable/core';
import React from 'react';
import { RowHeightBase } from './RowHeightBase';
import { useRowHeightNode } from './useRowHeightNode';

export const RowHeight: React.FC<{
  rowHeight?: RowHeightLevel;
  fieldNameDisplayLines?: number;
  onChange?: (type: 'rowHeight' | 'fieldNameDisplayLines', value: RowHeightLevel | number) => void;
  children: (
    text: string,
    isActive: boolean,
    Icon: React.FC<{ className?: string }>
  ) => React.ReactNode;
}> = ({ children, rowHeight, fieldNameDisplayLines, onChange }) => {
  const { text, Icon, isActive } = useRowHeightNode(rowHeight);

  return (
    <RowHeightBase
      rowHeight={text}
      fieldNameDisplayLines={fieldNameDisplayLines ?? 1}
      onChange={onChange}
    >
      {children(text, isActive, Icon)}
    </RowHeightBase>
  );
};
