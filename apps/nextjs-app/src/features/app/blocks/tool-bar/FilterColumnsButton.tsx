import type { IFieldInstance } from '@teable-group/sdk';
import { useFields, useViewId } from '@teable-group/sdk';
import EyeCloseIcon from '@teable-group/ui-lib/icons/app/eye-close.svg';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { Switch, Button, Input, Popover } from 'antd';
import React, { useState } from 'react';

export const FilterColumnsButton = () => {
  const activeViewId = useViewId();
  const fields = useFields({ entireColumn: true });

  const [searchText, setSearchText] = useState<string>('');

  const filterFields = (fields: IFieldInstance[], searchText: string, shouldBeHidden?: boolean) =>
    fields.filter(
      (field) =>
        activeViewId &&
        !field.isPrimary &&
        (!searchText || field.name.includes(searchText)) &&
        (!shouldBeHidden || field.columnMeta[activeViewId]?.hidden === shouldBeHidden)
    );

  const fieldData = filterFields(fields, searchText);
  const hiddenCount = filterFields(fields, searchText, true).length;

  const updateColumnHiddenStatus = (status: boolean) => {
    fieldData
      .filter((field) => activeViewId && field.columnMeta[activeViewId]?.hidden !== status)
      .forEach((field) => activeViewId && field.updateColumnHidden(activeViewId, status));
  };

  const handleDeselectAll = () => updateColumnHiddenStatus(true);
  const handleSelectAll = () => updateColumnHiddenStatus(false);

  const content = () => (
    <div>
      <div className="mt-3">
        <Input
          prefix={<SearchIcon />}
          placeholder="Find column"
          bordered={false}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
          }}
          className="mb-2"
        />
      </div>
      <div className="my-2 ml-0 mr-2 w-72">
        {fieldData.map((field) => (
          <div className="pt-px pl-2 pb-2 pr-px" key={field.id}>
            <Switch
              size="small"
              checked={Boolean(activeViewId && !field.columnMeta[activeViewId]?.hidden)}
              onChange={(checked) =>
                activeViewId && field.updateColumnHidden(activeViewId, !checked)
              }
            />
            <span className="ml-2 font-medium">{field.name}</span>
          </div>
        ))}
      </div>
      <div className="p-1">
        <Button size="small" type="text" onClick={handleDeselectAll}>
          HIDE ALL
        </Button>
        <Button size="small" type="text" className="float-right" onClick={handleSelectAll}>
          SHOW ALL
        </Button>
      </div>
    </div>
  );
  return (
    <Popover
      content={content()}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      transitionName=""
    >
      <button className="btn btn-xs btn-ghost font-normal">
        <EyeCloseIcon className="text-lg pr-1" />
        {hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields'}
      </button>
    </Popover>
  );
};
