import type { ILinkCellValue } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import type { LinkField } from '@teable-group/sdk';
import { AnchorProvider, SelectEditorMain, useRecords } from '@teable-group/sdk';
import { useMemo } from 'react';
import type { FC } from 'react';
import type { IEditorProps } from '../../../../grid/components';
import type { IWrapperEditorProps } from './type';

const LinkEditorInner: FC<IEditorProps & IWrapperEditorProps> = (props) => {
  const { record, style } = props;
  const field = props.field as LinkField;
  const cellValue = record.getCellValue(field.id) as ILinkCellValue | ILinkCellValue[] | undefined;

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
  const isMultiple = field.options.relationship !== Relationship.ManyOne;
  const records = useRecords(
    field.options.relationship === Relationship.OneMany
      ? {
          where: {
            [field.options.dbForeignKeyName]: null,
          },
        }
      : undefined
  );
  const choices = records.map(({ id, name }) => ({
    label: name,
    value: id,
  }));

  const onChange = (value?: string[] | string) => {
    const recordIds = value ? (isMultiple ? (value as string[]) : [value as string]) : [];
    const arrayCellValue = Array.isArray(cellValue) ? cellValue : cellValue ? [cellValue] : [];
    const newCellValue = recordIds.map((id) => ({
      id,
      title:
        arrayCellValue.find((record) => record.id === id)?.title ??
        records.find((record) => record.id === id)?.name,
    }));
    record.updateCell(field.id, isMultiple ? newCellValue : newCellValue?.[0]);
  };

  return (
    <SelectEditorMain
      style={style}
      value={values}
      options={choices}
      isMultiple={isMultiple}
      onChange={onChange}
    />
  );
};

export const LinkEditor = (props: IEditorProps & IWrapperEditorProps) => {
  const { field } = props;
  const tableId = (field as LinkField).options.foreignTableId;
  return (
    <AnchorProvider tableId={tableId}>
      <LinkEditorInner {...props} />
    </AnchorProvider>
  );
};
