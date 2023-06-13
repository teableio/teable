import { useFields, useViewId } from '@teable-group/sdk';
import EyeCloseIcon from '@teable-group/ui-lib/icons/app/eye-close.svg';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { Switch, Button, Input, Popover } from 'antd';
import React, { useState } from 'react';

export const FilterColumnsButton = () => {
  const activeViewId = useViewId();
  const fields = useFields(true);
  const [searchText, setSearchText] = useState<string>('');

  const fieldData = fields
    .filter((field) => !field.isPrimary)
    .filter((field) => !searchText || field.name.includes(searchText));

  const hiddenCount = fieldData.filter(
    (field) => activeViewId && field.columnMeta[activeViewId].hidden
  ).length;

  const handleDeselectAll = () => {
    fieldData
      .filter((field) => activeViewId && !field.columnMeta[activeViewId].hidden)
      .forEach((field) => {
        activeViewId && field.updateColumnHidden(activeViewId, true);
      });
  };

  const handleSelectAll = () => {
    fieldData
      .filter((field) => activeViewId && field.columnMeta[activeViewId].hidden)
      .forEach((field) => {
        activeViewId && field.updateColumnHidden(activeViewId, false);
      });
  };

  const content = () => (
    <div>
      <div style={{ marginTop: 12 }}>
        <Input
          prefix={<SearchIcon />}
          placeholder="Find column"
          bordered={false}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
          }}
          style={{ marginBottom: 8 }}
        />
      </div>
      <div style={{ margin: '8px 0px 8px 8px', width: 300 }}>
        {fieldData.map((field) => (
          <div style={{ padding: '1px 8px 7px 1px' }} key={field.id}>
            <Switch
              size="small"
              checked={Boolean(activeViewId && !field.columnMeta[activeViewId].hidden)}
              onChange={(checked) =>
                activeViewId && field.updateColumnHidden(activeViewId, !checked)
              }
            />
            <span style={{ marginLeft: 8 }} className="font-medium">
              {field.name}
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding: 4 }}>
        <Button size="small" type="text" onClick={handleDeselectAll}>
          HIDE ALL
        </Button>
        <Button size="small" type="text" style={{ float: 'right' }} onClick={handleSelectAll}>
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
