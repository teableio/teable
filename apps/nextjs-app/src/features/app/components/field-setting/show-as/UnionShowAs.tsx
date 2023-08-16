import type { INumberShowAs } from '@teable-group/core';
import { CellValueType } from '@teable-group/core';
import type { FC } from 'react';
import { useMemo } from 'react';
import { MultiNumberShowAs } from './MultiNumberShowAs';
import { SingleNumberShowAs } from './SingleNumberShowAs';

interface IUnionShowAsProps {
  showAs?: INumberShowAs;
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
  onChange?: (showAs?: INumberShowAs) => void;
}

export const UnionShowAs: FC<IUnionShowAsProps> = (props) => {
  const { showAs, cellValueType, isMultipleCellValue, onChange } = props;

  const ShowAsComponent = useMemo(() => {
    if (cellValueType === CellValueType.Number) {
      return isMultipleCellValue ? MultiNumberShowAs : SingleNumberShowAs;
    }
    return null;
  }, [cellValueType, isMultipleCellValue]);

  if (!ShowAsComponent) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ShowAsComponent showAs={showAs as any} onChange={onChange} />;
};
