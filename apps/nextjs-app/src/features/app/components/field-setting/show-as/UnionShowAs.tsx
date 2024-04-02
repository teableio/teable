import type { IUnionShowAs } from '@teable/core';
import { CellValueType } from '@teable/core';
import type { FC } from 'react';
import { useMemo } from 'react';
import { MultiNumberShowAs } from './MultiNumberShowAs';
import { SingleTextLineShowAs } from './SingleLineTextShowAs';
import { SingleNumberShowAs } from './SingleNumberShowAs';

interface IUnionShowAsProps {
  showAs?: IUnionShowAs;
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
  onChange?: (showAs?: IUnionShowAs) => void;
}

export const UnionShowAs: FC<IUnionShowAsProps> = (props) => {
  const { showAs, cellValueType, isMultipleCellValue, onChange } = props;

  const ShowAsComponent = useMemo(() => {
    if (cellValueType === CellValueType.Number) {
      return isMultipleCellValue ? MultiNumberShowAs : SingleNumberShowAs;
    }
    if (cellValueType === CellValueType.String) {
      return SingleTextLineShowAs;
    }
    return null;
  }, [cellValueType, isMultipleCellValue]);

  if (!ShowAsComponent) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ShowAsComponent showAs={showAs as any} onChange={onChange} />;
};
