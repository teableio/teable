import { EyeOff } from '@teable-group/icons';
import type { IFieldInstance } from '@teable-group/sdk';
import { useFields, useViewId } from '@teable-group/sdk';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import { Switch } from '@teable-group/ui-lib/shadcn/ui/switch';
import classNames from 'classnames';
import React, { useState } from 'react';

export const FilterColumnsButton = () => {
  const activeViewId = useViewId();
  const fields = useFields({ widthHidden: true });

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
    <div className="space-y-4">
      <div className="relative inline-flex items-center w-full">
        <Input
          className="pl-8 pr-2 py-1"
          placeholder="Find column"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
          }}
        />
        <SearchIcon className="text-xl absolute left-2 top-1/2 -translate-y-1/2" />
      </div>
      <div className="w-72 space-y-2">
        {fieldData.map((field) => (
          <div className="flex items-center space-x-2" key={field.id}>
            <Switch
              className="h-5 w-9"
              classNameThumb="w-4 h-4 data-[state=checked]:translate-x-4"
              id="airplane-mode"
              checked={Boolean(activeViewId && !field.columnMeta[activeViewId]?.hidden)}
              onCheckedChange={(checked) => {
                activeViewId && field.updateColumnHidden(activeViewId, !checked);
              }}
            />
            <Label htmlFor="airplane-mode" className="font-normal">
              {field.name}
            </Label>
          </div>
        ))}
      </div>
      <div className="p-1">
        <Button
          variant={'ghost'}
          size="xs"
          className="font-normal text-xs"
          onClick={handleDeselectAll}
        >
          HIDE ALL
        </Button>
        <Button
          variant={'ghost'}
          size="xs"
          className="float-right font-normal text-xs"
          onClick={handleSelectAll}
        >
          SHOW ALL
        </Button>
      </div>
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={'ghost'}
          size={'xs'}
          className={classNames('font-normal', { 'bg-secondary': hiddenCount })}
        >
          <EyeOff className="text-lg pr-1" />
          {hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields'}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start">
        {content()}
      </PopoverContent>
    </Popover>
  );
};
