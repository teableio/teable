import type { IGetRecordsRo, ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import { isMultiValueLink } from '@teable-group/core';
import { Plus } from '@teable-group/icons';
import { Button, Dialog, DialogContent, DialogTrigger, useToast } from '@teable-group/ui-lib';
import { useState, useRef, useMemo } from 'react';
import { AnchorProvider } from '../../../context';
import { ExpandRecorder } from '../../expand-record';
import type { ILinkEditorMainRef } from './EditorMain';
import { LinkEditorMain } from './EditorMain';
import { LinkListType } from './interface';
import type { ILinkListRef } from './LinkList';
import { LinkList } from './LinkList';

interface ILinkEditorProps {
  fieldId: string;
  recordId: string | undefined;
  options: ILinkFieldOptions;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
  readonly?: boolean;
  className?: string;
}

export const LinkEditor = (props: ILinkEditorProps) => {
  const { fieldId, recordId, cellValue, options, onChange, readonly, className } = props;
  const { toast } = useToast();
  const listRef = useRef<ILinkListRef>(null);
  const linkEditorMainRef = useRef<ILinkEditorMainRef>(null);
  const [isEditing, setEditing] = useState<boolean>(false);
  const [expandRecordId, setExpandRecordId] = useState<string>();

  const { foreignTableId, relationship } = options;
  const isMultiple = isMultiValueLink(relationship);
  const cvArray = Array.isArray(cellValue) || !cellValue ? cellValue : [cellValue];
  const recordIds = cvArray?.map((cv) => cv.id);
  const selectedRowCount = recordIds?.length ?? 0;

  const recordQuery = useMemo((): IGetRecordsRo => {
    return {
      filterLinkCellSelected: recordId ? [fieldId, recordId] : fieldId,
    };
  }, [fieldId, recordId]);

  const updateExpandRecordId = (recordId?: string) => {
    if (recordId) {
      const existed = document.getElementById(`${foreignTableId}-${recordId}`);
      if (existed) {
        toast({ description: 'This record is already open.' });
        return;
      }
    }
    setExpandRecordId(recordId);
  };

  const onSelectedRecordExpand = (recordId: string) => {
    updateExpandRecordId(recordId);
  };

  const onSelectedRecordChange = (value?: ILinkCellValue[]) => {
    if (value == null) return onChange?.(undefined);
    onChange?.(isMultiple ? value : value[0]);
  };

  const onOpenChange = (open: boolean) => {
    if (open) return setEditing?.(true);
    return linkEditorMainRef.current?.onReset();
  };

  const onExpandRecord = (recordId: string) => {
    setExpandRecordId(recordId);
  };

  return (
    <div className="space-y-3">
      {Boolean(selectedRowCount) && (
        <div className="relative h-40 w-full overflow-hidden rounded-md border">
          <AnchorProvider tableId={foreignTableId}>
            <LinkList
              ref={listRef}
              type={LinkListType.Selected}
              rowCount={selectedRowCount}
              cellValue={cellValue}
              isMultiple={isMultiple}
              recordQuery={recordQuery}
              onChange={onSelectedRecordChange}
              onExpand={onSelectedRecordExpand}
            />
          </AnchorProvider>
        </div>
      )}
      {!readonly && (
        <ExpandRecorder
          tableId={foreignTableId}
          recordId={expandRecordId}
          recordIds={recordIds}
          onUpdateRecordIdCallback={updateExpandRecordId}
          onClose={() => updateExpandRecordId(undefined)}
        />
      )}
      {!readonly && (
        <Dialog open={isEditing} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline" size={'sm'} className={className}>
              <Plus />
              Add Record
            </Button>
          </DialogTrigger>
          <DialogContent className="flex h-[520px] max-w-4xl flex-col">
            <LinkEditorMain
              {...props}
              ref={linkEditorMainRef}
              isEditing={isEditing}
              setEditing={setEditing}
              onExpandRecord={onExpandRecord}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
