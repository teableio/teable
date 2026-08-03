import type { IUnionFormatting } from '@teable/core';
import { CellValueType } from '@teable/core';
import { useMemo } from 'react';
import { DatetimeFormatting } from './DatetimeFormatting';
import { NumberFormatting } from './NumberFormatting';

export const UnionFormatting = (props: {
  cellValueType: string;
  formatting?: IUnionFormatting;
  onChange?: (formatting: IUnionFormatting) => void;
}) => {
  const { cellValueType, formatting, onChange } = props;

  const FormattingComponent = useMemo(
    function getFormattingComponent() {
      switch (cellValueType) {
        case CellValueType.DateTime:
          return DatetimeFormatting;
        case CellValueType.Number:
          return NumberFormatting;
        default:
          return null;
      }
    },
    [cellValueType]
  );
  if (!FormattingComponent) {
    return <></>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <FormattingComponent formatting={formatting as any} onChange={onChange} />;
};
