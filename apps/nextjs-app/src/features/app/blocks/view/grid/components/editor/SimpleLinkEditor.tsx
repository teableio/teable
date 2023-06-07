import type { ILinkCellValue } from '@teable-group/core';
import { Colors, ColorUtils, Relationship } from '@teable-group/core';
import type { LinkField, Record } from '@teable-group/sdk';
import { AnchorProvider, FieldProvider, RecordProvider, useRecords } from '@teable-group/sdk';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { Checkbox, Input, Space } from 'antd';
import type { CheckboxValueType } from 'antd/es/checkbox/Group';
import classNames from 'classnames';
import { useMemo, useState } from 'react';

export interface ILinkEditorProps {
  field: LinkField;
  record: Record;
  style?: React.CSSProperties;
  onCancel?: () => void;
}

const SimpleLinkEditor = (props: ILinkEditorProps) => {
  const { field, record, style } = props;
  const cellValue = record.getCellValue(field.id) as ILinkCellValue | ILinkCellValue[] | undefined;
  const value = Array.isArray(cellValue)
    ? cellValue.map((v) => v.id)
    : cellValue
    ? [cellValue.id]
    : undefined;
  const [filterInput, setFilterInput] = useState<string>();
  const records = useRecords();
  const choices = useMemo(() => {
    return (records || []).filter(
      (record) => !filterInput || record.name.indexOf(filterInput) !== -1
    );
  }, [records, filterInput]);

  const onChangeInner = (value: CheckboxValueType[]) => {
    let newCellValue = null;
    if (field.options.relationship === Relationship.ManyOne) {
      const id = value?.[value.length - 1]?.toString() ?? null;
      if (id) {
        const title = records.find((record) => record.id === id)?.name;
        newCellValue = { id, title };
      }
    } else {
      newCellValue = (value as string[]).map((id) => ({
        id,
        title: records.find((record) => record.id === id)?.name,
      }));
    }
    record.updateCell(field.id, newCellValue);
  };

  return (
    <div className="bg-base-100 rounded-sm shadow-sm p-2 shadow-base-300" style={style}>
      <Input
        className="mb-2"
        prefix={<SearchIcon />}
        placeholder="search"
        value={filterInput}
        onChange={(e) => setFilterInput(e.target.value)}
      />
      {choices.length === 0 && <div className="text-sm text-center">No Data</div>}
      <Checkbox.Group className="w-full" value={value} onChange={onChangeInner}>
        <Space direction={'vertical'} size={10}>
          {choices.map(({ name, id }) => {
            return (
              <div className="flex items-center mb-2" key={id}>
                <Checkbox value={id}>
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
                </Checkbox>
              </div>
            );
          })}
        </Space>
      </Checkbox.Group>
    </div>
  );
};

export const LinkEditor = (props: ILinkEditorProps) => {
  const tableId = props.field.options.foreignTableId;
  return (
    <AnchorProvider value={{ tableId }}>
      <FieldProvider fallback={<h1>Empty</h1>}>
        <RecordProvider>
          <SimpleLinkEditor {...props} />
        </RecordProvider>
      </FieldProvider>
    </AnchorProvider>
  );
};
