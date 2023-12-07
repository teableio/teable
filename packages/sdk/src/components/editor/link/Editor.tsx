import type { ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import { isMultiValueLink } from '@teable-group/core';
import { Plus, X } from '@teable-group/icons';
import { Button, Dialog, DialogContent, DialogTrigger, useToast } from '@teable-group/ui-lib';
import { noop } from 'lodash';
import { useState, useRef } from 'react';
import { ExpandRecorder } from '../../expand-record';
import type { ILinkEditorMainRef } from './EditorMain';
import { LinkEditorMain } from './EditorMain';

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
  const { cellValue, options, onChange, readonly, className } = props;
  const { toast } = useToast();
  const linkEditorMainRef = useRef<ILinkEditorMainRef>(null);
  const [isEditing, setEditing] = useState<boolean>(false);
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const { foreignTableId, relationship } = options;

  const cvArray = Array.isArray(cellValue) || !cellValue ? cellValue : [cellValue];
  const isMultiple = isMultiValueLink(relationship);
  const recordIds = cvArray?.map((cv) => cv.id);

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

  const onRecordClick = (recordId: string) => {
    updateExpandRecordId(recordId);
  };

  const onDeleteRecord = (recordId: string) => {
    onChange?.(
      isMultiple ? (cellValue as ILinkCellValue[])?.filter((cv) => cv.id !== recordId) : undefined
    );
  };

  const onOpenChange = (open: boolean) => {
    if (open) return setEditing?.(true);
    return linkEditorMainRef.current?.onReset();
  };

  return (
    <div className="space-y-3">
      {cvArray?.map(({ id, title }) => (
        <div
          key={id}
          tabIndex={-1}
          role={'button'}
          className="group relative cursor-pointer rounded-md border px-4 py-2 font-mono text-sm shadow-sm"
          onClick={() => onRecordClick(id)}
          onKeyDown={noop}
        >
          {title || 'Unnamed record'}
          {!readonly && (
            <Button
              className="absolute right-0 top-0 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full opacity-0 group-hover:opacity-100"
              size={'icon'}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteRecord(id);
              }}
            >
              <X />
            </Button>
          )}
        </div>
      ))}
      <ExpandRecorder
        tableId={foreignTableId}
        recordId={expandRecordId}
        recordIds={recordIds}
        onUpdateRecordIdCallback={updateExpandRecordId}
        onClose={() => updateExpandRecordId(undefined)}
      />
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
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
