import { CellValueType } from '@teable/core';
import { Input } from '@teable/ui-lib';
import type { Field } from '../../model';
import { CheckboxEditor } from '../editor';

interface IComputedEditorProps {
  field: Field;
  cellValue: unknown;
}

export const ComputedEditor = (props: IComputedEditorProps) => {
  const { field, cellValue } = props;
  const { cellValueType } = field;

  if (cellValueType === CellValueType.Boolean) {
    return <CheckboxEditor value={cellValue as boolean} readonly />;
  }

  return (
    <Input
      className="h-8 disabled:cursor-text"
      value={field.cellValue2String(cellValue)}
      disabled
    />
  );
};
