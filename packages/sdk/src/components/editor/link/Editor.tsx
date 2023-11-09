import type { ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { Plus, X } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, useToast } from '@teable-group/ui-lib';
import { noop } from 'lodash';
import { useState } from 'react';
import { ExpandRecorder } from '../../expand-record';
import { LinkEditorMain } from './EditorMain';

interface ILinkEditorProps {
  options: ILinkFieldOptions;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
  disabled?: boolean;
  className?: string;
}

export const LinkEditor = (props: ILinkEditorProps) => {
  const { cellValue, options, onChange, disabled, className } = props;
  const { toast } = useToast();
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const { foreignTableId, relationship } = options;

  const cvArray = Array.isArray(cellValue) || !cellValue ? cellValue : [cellValue];
  const isMultiple = relationship !== Relationship.ManyOne;
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
          <Button
            className="absolute right-0 top-0 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full opacity-0 group-hover:opacity-100"
            size={'icon'}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteRecord(id);
            }}
            disabled={disabled}
          >
            <X />
          </Button>
        </div>
      ))}
      <ExpandRecorder
        tableId={foreignTableId}
        recordId={expandRecordId}
        recordIds={recordIds}
        onUpdateRecordIdCallback={updateExpandRecordId}
        onClose={() => updateExpandRecordId(undefined)}
      />
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="outline" size={'sm'} className={className}>
            <Plus />
            Add Record
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <LinkEditorMain {...props} />
        </PopoverContent>
      </Popover>
    </div>
  );
};
