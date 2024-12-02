import { FieldType } from '@teable/core';
import type { IFieldInstance } from '../../model';
import { CellValue } from '../cell-value/CellValue';
import { CellEditorMain } from './CellEditorMain';
import type { ICellValueEditor } from './type';

export const CellEditor = (props: ICellValueEditor) => {
  const { field, cellValue, readonly, wrapStyle, wrapClassName } = props;
  const { type, isComputed } = field;
  const isAttachment = type === FieldType.Attachment;
  const isRating = type === FieldType.Rating;

  return (
    <div style={wrapStyle} className={wrapClassName}>
      {(readonly || isComputed) && !isAttachment ? (
        <CellValue
          field={field as unknown as IFieldInstance}
          value={cellValue}
          className="text-sm"
          itemClassName={isRating ? 'size-5' : undefined}
        />
      ) : (
        <CellEditorMain {...props} />
      )}
    </div>
  );
};
