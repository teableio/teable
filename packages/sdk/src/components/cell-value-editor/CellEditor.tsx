import { CellEditorMain } from './CellEditorMain';
import { ComputedEditor } from './ComputedEditor';
import type { ICellValueEditor } from './type';

export const CellEditor = (props: ICellValueEditor) => {
  const { field, cellValue, style, className } = props;
  const { isComputed } = field;

  return (
    <div style={style} className={className}>
      {isComputed ? (
        <ComputedEditor cellValueString={field.cellValue2String(cellValue)} />
      ) : (
        <CellEditorMain {...props} />
      )}
    </div>
  );
};
