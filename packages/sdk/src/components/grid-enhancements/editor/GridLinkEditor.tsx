import type { ILinkCellValue } from '@teable-group/core';
import { Dialog, DialogContent } from '@teable-group/ui-lib';
import { useRef, type FC, useState, useMemo } from 'react';
import { type LinkField } from '../../../model';
import type { ILinkEditorMainRef } from '../../editor';
import { LinkEditorMain } from '../../editor';
import { ExpandRecorder } from '../../expand-record';
import type { IEditorProps } from '../../grid/components';
import type { IWrapperEditorProps } from './type';

export const GridLinkEditor: FC<IEditorProps & IWrapperEditorProps> = (props) => {
  const { record, field, isEditing, setEditing } = props;
  const { id: fieldId, options } = field as LinkField;
  const { foreignTableId } = options;
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const cellValue = record.getCellValue(fieldId) as ILinkCellValue | ILinkCellValue[] | undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const linkEditorMainRef = useRef<ILinkEditorMainRef>(null);

  const expandRecordIds = useMemo(() => {
    if (expandRecordId == null) return;
    return [expandRecordId];
  }, [expandRecordId]);

  const onOpenChange = (open: boolean) => {
    if (open) return setEditing?.(true);
    return linkEditorMainRef.current?.onReset();
  };

  const onChange = (value?: ILinkCellValue | ILinkCellValue[]) => {
    record.updateCell(fieldId, value);
  };

  const onExpandRecord = (recordId: string) => {
    setExpandRecordId(recordId);
  };

  return (
    <>
      <div ref={containerRef} />
      <ExpandRecorder
        tableId={foreignTableId}
        recordId={expandRecordId}
        recordIds={expandRecordIds}
        onClose={() => setExpandRecordId(undefined)}
      />
      <Dialog open={isEditing} onOpenChange={onOpenChange}>
        <DialogContent
          container={containerRef.current}
          className="flex h-[520px] max-w-4xl flex-col"
        >
          <LinkEditorMain
            ref={linkEditorMainRef}
            recordId={record.id}
            fieldId={fieldId}
            cellValue={cellValue}
            options={options}
            isEditing={isEditing}
            onChange={onChange}
            setEditing={setEditing}
            onExpandRecord={onExpandRecord}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
