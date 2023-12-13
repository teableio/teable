import type { ILinkCellValue } from '@teable-group/core';
import { Plus } from '@teable-group/icons';
import { LinkCard } from '@teable-group/sdk/components';
import type { LinkField } from '@teable-group/sdk/model';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn';
import { useMemo, useState } from 'react';
import { LinkRecordList } from './LinkRecordList';

interface IShareFormLinkEditorProps {
  shareId: string;
  field: LinkField;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  className?: string;
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
}

export const ShareFormLinkEditor = (props: IShareFormLinkEditorProps) => {
  const { cellValue, shareId, className, field, onChange } = props;
  const [open, setOpen] = useState(false);

  const isMultiple = field.isMultipleCellValue;

  const cvArray = useMemo(() => {
    return isMultiple || !cellValue
      ? (cellValue as ILinkCellValue[] | undefined)
      : [cellValue as ILinkCellValue];
  }, [cellValue, isMultiple]);

  const onDeleteRecord = (recordId: string) => {
    onChange?.(
      isMultiple ? (cellValue as ILinkCellValue[])?.filter((cv) => cv.id !== recordId) : undefined
    );
  };

  const selectedRecordIds = useMemo(() => {
    return cvArray?.map((cv) => cv.id);
  }, [cvArray]);

  const onSelected = (selectedCellValue: ILinkCellValue) => {
    if (isMultiple) {
      const arr = (cellValue as ILinkCellValue[]) || [];
      onChange?.([...arr, selectedCellValue]);
      return;
    }
    setOpen(false);
    onChange?.(selectedCellValue);
  };

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size={'sm'} className={className}>
            <Plus />
            Add Record
          </Button>
        </PopoverTrigger>
        <PopoverContent className="h-[350px] w-screen md:w-[480px]">
          <LinkRecordList
            shareId={shareId}
            field={field}
            selectedRecordIds={selectedRecordIds}
            onSelected={onSelected}
          />
        </PopoverContent>
      </Popover>
      {cvArray?.map(({ id, title }) => (
        <LinkCard key={id} title={title} className="truncate" onDelete={() => onDeleteRecord(id)} />
      ))}
    </div>
  );
};
