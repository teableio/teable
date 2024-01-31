import type { RowHeightLevel } from '@teable/core';
import React from 'react';
import { RowHeightBase } from './RowHeightBase';
import { useRowHeightNode } from './useRowHeightNode';

export const RowHeight: React.FC<{
  rowHeight: RowHeightLevel | null;
  onChange?: (rowHeight: RowHeightLevel) => void;
  children: (
    text: string,
    isActive: boolean,
    Icon: React.FC<{ className?: string }>
  ) => React.ReactNode;
}> = ({ children, onChange, rowHeight }) => {
  const { text, Icon, isActive } = useRowHeightNode(rowHeight);

  return (
    <RowHeightBase value={text} onChange={onChange}>
      {children(text, isActive, Icon)}
    </RowHeightBase>
  );
};
