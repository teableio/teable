import { Search } from '@teable-group/icons';
import {
  Input,
  Switch,
  Label,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@teable-group/ui-lib';
import React, { useState } from 'react';
import { useViewId, useFields } from '../../hooks';
import type { IFieldInstance } from '../../model';

export const HideFields: React.FC<{
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ children }) => {
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
        <Search className="text-xl absolute left-2 top-1/2 -translate-y-1/2" />
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
        {children(
          hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields',
          Boolean(hiddenCount)
        )}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start">
        {content()}
      </PopoverContent>
    </Popover>
  );
};
