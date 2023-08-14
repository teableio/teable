import type { ILinkCellValue, ILinkFieldOptions } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import { useMemo } from 'react';
import { AnchorProvider } from '../../context';
import { useRecords } from '../../hooks';
import { SelectEditor } from '../editor';

interface ILinkEditorProps {
  options: ILinkFieldOptions;
  cellValue?: ILinkCellValue | ILinkCellValue[];
  onChange?: (value?: ILinkCellValue | ILinkCellValue[]) => void;
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
    <SelectEditor
      value={values}
      options={choices}
      isMultiple={isMultiple}
      onChange={onChangeInner}
    />
  );
};

export const LinkEditor = (props: ILinkEditorProps) => {
  const { options } = props;
  const { foreignTableId } = options;
  return (
    <AnchorProvider tableId={foreignTableId}>
      <LinkEditorInner {...props} />
    </AnchorProvider>
  );
};
