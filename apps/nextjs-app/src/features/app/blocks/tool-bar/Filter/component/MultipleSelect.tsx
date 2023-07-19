import type { Colors } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import type { MultipleSelectField, SingleSelectField } from '@teable-group/sdk';

import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib/shadcn/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import classNames from 'classnames';
import { ChevronsUpDown } from 'lucide-react';

import { useMemo, useState } from 'react';

interface IMutipleSelect {
  onSelect?: (names: string[]) => void;
  value: string[] | null;
  // SingleSelectField used in MultipleSelect in filter scenario
  field: MultipleSelectField | SingleSelectField;
}

const MultipleSelect = (props: IMutipleSelect) => {
  const { field, value, onSelect } = props;
  const values = useMemo(() => {
    if (Array.isArray(value) && value.length) {
      return value;
    }
    return [];
  }, [value]);
  const [open, setOpen] = useState(false);
  const choices = useMemo(() => {
    return field?.options?.choices;
  }, [field]);

  const selectHandler = (name: string) => {
    let newCellValue = null;
    const existIndex = values.findIndex((item) => item === name);
    if (existIndex > -1) {
      newCellValue = values.slice();
      newCellValue.splice(existIndex, 1);
    } else {
      newCellValue = [...values, name];
    }
    onSelect?.(newCellValue);
  };

  const getColorByName = (name: string) => {
    const defaultColor = 'blueBright' as Colors;
    const index = choices.findIndex((choice) => choice.name === name);
    if (index > -1) {
      return choices[index].color;
    }
    return defaultColor;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-32 max-w-[128px] justify-between m-1 overflow-hidden"
        >
          <div className="shrink whitespace-nowrap overflow-hidden flex">
            {Array.isArray(values) && values.length
              ? values?.map((item, index) => (
                  <div
                    key={index}
                    className={classNames('px-2 rounded-lg m-1')}
                    style={{
                      backgroundColor: ColorUtils.getHexForColor(getColorByName(item)),
                      color: ColorUtils.shouldUseLightTextOnColor(getColorByName(item))
                        ? '#ffffff'
                        : '#000000',
                    }}
                  >
                    {item}
                  </div>
                ))
              : 'Select'}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs">
        <Command className="rounded-sm">
          <CommandList>
            <CommandInput placeholder="Search option" />
            <CommandEmpty>No found.</CommandEmpty>
            <CommandGroup aria-valuetext="name">
              {choices.length ? (
                choices.map(({ color, name }) => (
                  <CommandItem key={name} value={name} onSelect={() => selectHandler(name)}>
                    <SelectIcon
                      className={classNames(
                        'mr-2 h-4 w-4 shrink-0',
                        values?.map((name) => name)?.includes(name) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div
                      className={classNames('px-2 rounded-lg')}
                      style={{
                        backgroundColor: ColorUtils.getHexForColor(color),
                        color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                      }}
                    >
                      {name}
                    </div>
                  </CommandItem>
                ))
              ) : (
                <span className="text-sm text-gray-600">no result</span>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

MultipleSelect.displayName = 'MultipleSelect';

export { MultipleSelect };
