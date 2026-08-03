import { FieldType } from '@teable/core';
import type { IFieldInstance } from '../../model';
import { CellValue } from '../cell-value/CellValue';
import { CollapsibleCellValue } from '../expand-record/CollapsibleCellValue';
import { CellEditorMain } from './CellEditorMain';
import type { ICellValueEditor } from './type';

export const CellEditor = (props: ICellValueEditor) => {
  const { field, cellValue, wrapStyle, wrapClassName } = props;
  const { type, isComputed } = field;
  const isAttachment = type === FieldType.Attachment;
  const isRating = type === FieldType.Rating;
  const isButton = type === FieldType.Button;
  const readonly = isButton ? false : props.readonly;
  const collapsible = Boolean(
    isComputed || (readonly && (type === FieldType.LongText || type === FieldType.SingleLineText))
  );

  const cellValueNode = (
    <CellValue
      field={field as unknown as IFieldInstance}
      value={cellValue}
      className="text-sm"
      itemClassName={isRating ? 'size-5' : undefined}
      readonly={readonly}
    />
  );

  return (
    <div style={wrapStyle} className={wrapClassName}>
      {(readonly || isComputed) && !isAttachment ? (
        collapsible ? (
          <CollapsibleCellValue>{cellValueNode}</CollapsibleCellValue>
        ) : (
          cellValueNode
        )
      ) : (
        <CellEditorMain {...props} />
      )}
    </div>
  );
};
