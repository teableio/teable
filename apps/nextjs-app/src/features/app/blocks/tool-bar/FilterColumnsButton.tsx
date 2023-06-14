import type { IFieldInstance } from '@teable-group/sdk';
import { useFields, useViewId } from '@teable-group/sdk';
import EyeCloseIcon from '@teable-group/ui-lib/icons/app/eye-close.svg';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

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
    <div className="space-y-4">
      <Input
        placeholder="Find column"
        value={searchText}
        onChange={(e) => {
          setSearchText(e.target.value);
        }}
        className="h-8"
      />
      <div className="w-72 space-y-2">
        {fieldData.map((field) => (
          <div className="flex items-center space-x-2" key={field.id}>
            <Switch
              className="h-5 w-9"
              classNameThumb="w-4 h-4 data-[state=checked]:translate-x-4"
              id="airplane-mode"
              checked={Boolean(activeViewId && !field.columnMeta[activeViewId].hidden)}
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
          size="xxs"
          className="font-normal text-xs"
          onClick={handleDeselectAll}
        >
          HIDE ALL
        </Button>
        <Button
          variant={'ghost'}
          size="xxs"
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
        <Button variant={'ghost'} size={'xs'} className="font-normal">
          <EyeCloseIcon className="text-lg pr-1" />
          {hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields'}
        </Button>
      </PopoverTrigger>
      <PopoverContent>{content()}</PopoverContent>
    </Popover>
  );
};
