import { CellValueType } from '@teable/core';
import { Input } from '@teable/ui-lib';
import type { Field } from '../../model';
import { CellCheckbox } from '../cell-value/cell-checkbox';

interface IComputedEditorProps {
  field: Field;
  cellValue: unknown;
}

export const ComputedEditor = (props: IComputedEditorProps) => {
  const { field, cellValue } = props;
  const { cellValueType } = field;

  if (cellValueType === CellValueType.Boolean) {
    return <CellCheckbox value={cellValue as boolean | boolean[]} itemClassName="size-6" />;
  }

  return (
    <Input
      className="h-8 disabled:cursor-text"
      value={field.cellValue2String(cellValue)}
      disabled
    />
  );
};
