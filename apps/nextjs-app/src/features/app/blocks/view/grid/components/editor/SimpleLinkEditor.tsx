import type { ILinkCellValue } from '@teable-group/core';
import { Relationship } from '@teable-group/core';
import type { LinkField, Record } from '@teable-group/sdk';
import { AnchorProvider, LinkEditorMain, useRecords } from '@teable-group/sdk';

export interface ILinkEditorProps {
  field: LinkField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}

const SimpleLinkEditor = (props: ILinkEditorProps) => {
  const { field, record, style } = props;
  const cellValue = record.getCellValue(field.id) as ILinkCellValue | ILinkCellValue[] | undefined;
  const values = Array.isArray(cellValue)
    ? cellValue.map((v) => v.id)
    : cellValue
    ? [cellValue.id]
    : undefined;
  const isMultiple = field.options.relationship !== Relationship.ManyOne;
  // many <> one relation ship only allow select record that has not been selected
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

  const onChange = (recordIds: string[]) => {
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
    <LinkEditorMain
      style={style}
      value={values}
      options={choices}
      isMultiple={isMultiple}
      onChange={onChange}
    />
  );
};

export const LinkEditor = (props: ILinkEditorProps) => {
  const tableId = props.field.options.foreignTableId;
  return (
    <AnchorProvider tableId={tableId} fallback={<h1>Empty</h1>}>
      <SimpleLinkEditor {...props} />
    </AnchorProvider>
  );
};
