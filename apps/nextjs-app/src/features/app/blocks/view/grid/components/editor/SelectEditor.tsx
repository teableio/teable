import type { SelectFieldOptions } from '@teable-group/core';
import { FieldType, ColorUtils } from '@teable-group/core';
import type { MultipleSelectField, SingleSelectField, Record } from '@teable-group/sdk';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { Checkbox, Input, Space } from 'antd';
import type { CheckboxValueType } from 'antd/es/checkbox/Group';
import classNames from 'classnames';
import { isString } from 'lodash';
import { useMemo, useState } from 'react';

export const SelectEditor = (props: {
  field: SingleSelectField | MultipleSelectField;
  record: Record;
  style?: React.CSSProperties;
}) => {
  const { field, record, style } = props;
  const cellValue = record.getCellValue(field.id);
  const value = isString(cellValue) ? [cellValue] : (cellValue as string[]);
  const [filterInput, setFilterInput] = useState<string>();
  const optionChoices = (field?.options as SelectFieldOptions)?.choices;
  const choices = useMemo(() => {
    return (optionChoices || []).filter(
      (choice) => !filterInput || choice.name.indexOf(filterInput) !== -1
    );
  }, [optionChoices, filterInput]);

  const onChangeInner = (value: CheckboxValueType[]) => {
    let newCellValue = null;
    if (field.type === FieldType.SingleSelect) {
      newCellValue = value?.[value.length - 1]?.toString() ?? null;
    } else {
      newCellValue = value as string[];
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
          {choices.map(({ name, color }) => {
            return (
              <div className="flex items-center mb-2" key={name}>
                <Checkbox key={name} value={name}>
                  <div
                    className={classNames('px-2 rounded-lg')}
                    style={{
                      backgroundColor: ColorUtils.getHexForColor(color),
                      color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                    }}
                  >
                    {name}
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
