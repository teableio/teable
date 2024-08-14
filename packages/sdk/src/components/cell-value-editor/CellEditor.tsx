import { FieldType } from '@teable/core';
import type { IFieldInstance } from '../../model';
import { CellValue } from '../cell-value/CellValue';
import { CellEditorMain } from './CellEditorMain';
import type { ICellValueEditor } from './type';

export const CellEditor = (props: ICellValueEditor) => {
  const { field, cellValue, readonly, wrapStyle, wrapClassName } = props;
  const { type, isComputed } = field;
  const isAttachment = type === FieldType.Attachment;

  return (
    <div style={wrapStyle} className={wrapClassName}>
      {readonly || isComputed ? (
        <CellValue
          field={field as unknown as IFieldInstance}
          value={cellValue}
          className={isAttachment ? 'gap-3' : undefined}
          itemClassName={isAttachment ? 'size-28 rounded-md' : undefined}
        />
      ) : (
        <CellEditorMain {...props} />
      )}
    </div>
  );
};
