import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { CellEditor } from '../cell-value-editor';
import type { ICellValueEditor } from '../cell-value-editor/type';
import { LinkDisplayType, LinkEditor } from '../editor';

export const CellEditorWrap = (props: ICellValueEditor) => {
  const { field, wrapClassName, className, cellValue, onChange, readonly, recordId } = props;
  if (field.type === FieldType.Link) {
    return (
      <div className={cn(wrapClassName, 'max-h-96 overflow-auto')}>
        <LinkEditor
          className={className}
          cellValue={cellValue as ILinkCellValue | ILinkCellValue[]}
          options={field.options as ILinkFieldOptions}
          onChange={onChange}
          readonly={readonly}
          fieldId={field.id}
          recordId={recordId}
          displayType={readonly ? LinkDisplayType.List : LinkDisplayType.Grid}
        />
      </div>
    );
  }
  return <CellEditor {...props} />;
};
