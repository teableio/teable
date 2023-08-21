import type { ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { Plus, X } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, useToast } from '@teable-group/ui-lib';
import { noop } from 'lodash';
import { useMemo } from 'react';
import { AnchorProvider } from '../../context';
import { useRecords } from '../../hooks';
import { SelectEditorMain } from '../editor';
import { useExpandRecord } from '../expand-record';

interface ILinkEditorProps {
  options: ILinkFieldOptions;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
  disabled?: boolean;
}

const LinkEditorInner = (props: ILinkEditorProps) => {
  const { cellValue, options, onChange } = props;

  const { relationship, dbForeignKeyName } = options;

  const values = useMemo(
    () =>
      Array.isArray(cellValue)
        ? cellValue.map((v) => v.id)
        : cellValue
        ? [cellValue.id]
        : undefined,
    [cellValue]
  );

  // many <> one relation ship only allow select record that has not been selected
  const isMultiple = relationship !== Relationship.ManyOne;
  const records = useRecords(
    relationship === Relationship.OneMany
      ? {
          where: {
            [dbForeignKeyName]: null,
          },
        }
      : undefined
  );
  const choices = records.map(({ id, name }) => ({
    label: name,
    value: id,
  }));

  const onChangeInner = (value?: string[] | string) => {
    const recordIds = value ? (isMultiple ? (value as string[]) : [value as string]) : [];
    const arrayCellValue = Array.isArray(cellValue) ? cellValue : cellValue ? [cellValue] : [];
    const newCellValue = recordIds.map((id) => ({
      id,
      title:
        arrayCellValue.find((record) => record.id === id)?.title ??
        records.find((record) => record.id === id)?.name,
    }));
    onChange?.(isMultiple ? newCellValue : newCellValue?.[0]);
  };

  return (
    <SelectEditorMain
      value={values}
      options={choices}
      isMultiple={isMultiple}
      onChange={onChangeInner}
    />
  );
};

export const LinkEditorMain = (props: ILinkEditorProps) => {
  const { options } = props;
  const { foreignTableId } = options;
  return (
    <AnchorProvider tableId={foreignTableId}>
      <LinkEditorInner {...props} />
    </AnchorProvider>
  );
};

export const LinkEditor = (props: ILinkEditorProps) => {
  const { cellValue, options, onChange, disabled } = props;
  const { toast } = useToast();
  const { addExpandRecord } = useExpandRecord();
  const { foreignTableId, relationship } = options;

  const cvArray = Array.isArray(cellValue) || !cellValue ? cellValue : [cellValue];
  const isMultiple = relationship !== Relationship.ManyOne;

  const onRecordClick = (recordId: string) => {
    const { existed } = addExpandRecord({
      tableId: foreignTableId,
      recordId,
      recordIds: cvArray?.map((cv) => cv.id),
    });
    existed && toast({ description: 'This record is already open.' });
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
          className="relative rounded-md border px-4 py-2 font-mono text-sm shadow-sm cursor-pointer group"
          onClick={() => onRecordClick(id)}
          onKeyDown={noop}
        >
          {title || 'Unnamed record'}
          <Button
            className="absolute w-4 h-4 right-0 top-0 rounded-full translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100"
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
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="outline">
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
