import type { ILinkCellValue } from '@teable-group/core';
import { Colors, ColorUtils, Relationship } from '@teable-group/core';
import type { LinkField, Record } from '@teable-group/sdk';
import { AnchorProvider, FieldProvider, RecordProvider, useRecords } from '@teable-group/sdk';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import classNames from 'classnames';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

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
  const choices = records;

  const onSelect = (value: string) => {
    let newCellValue = null;
    const currentValues = values?.slice() || [];
    const existIndex = currentValues.findIndex((item) => item === value);
    if (existIndex > -1) {
      currentValues.splice(existIndex, 1);
    } else {
      newCellValue = currentValues.push(value);
    }
    if (field.options.relationship === Relationship.ManyOne) {
      const id = currentValues?.[currentValues.length - 1]?.toString() ?? null;
      if (id) {
        const title = records.find((record) => record.id === id)?.name;
        newCellValue = { id, title };
      }
    } else {
      newCellValue = currentValues.map((id) => ({
        id,
        title:
          ((cellValue as ILinkCellValue[]) || []).find((record) => record.id === id)?.title ??
          records.find((record) => record.id === id)?.name,
      }));
    }
    record.updateCell(field.id, newCellValue);
  };

  return (
    <Command className="rounded-sm shadow-sm p-2" style={style}>
      <CommandList>
        <CommandInput placeholder="Search option" />
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {choices.map(({ name, id }) => (
            <CommandItem key={id} value={id} onSelect={() => onSelect(id)}>
              <SelectIcon
                className={classNames(
                  'mr-2 h-4 w-4',
                  values?.includes(id) ? 'opacity-100' : 'opacity-0'
                )}
              />
              <div
                className={classNames('px-2 rounded-lg')}
                style={{
                  backgroundColor: ColorUtils.getHexForColor(Colors.GrayBright),
                  color: ColorUtils.shouldUseLightTextOnColor(Colors.GrayBright)
                    ? '#ffffff'
                    : '#000000',
                }}
              >
                {name || 'Untitled'}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
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
