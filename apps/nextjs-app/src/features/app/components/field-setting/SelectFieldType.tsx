import { FieldType } from '@teable-group/core';
import ArrowDownIcon from '@teable-group/ui-lib/icons/app/arrow-down.svg';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import classNames from 'classnames';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FIELD_CONSTANT } from '../../utils';

export const SelectFieldType = (props: {
  value?: FieldType;
  onChange?: (type: FieldType) => void;
}) => {
  const { value = FieldType.SingleLineText, onChange } = props;
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? FIELD_CONSTANT.find(({ type }) => type === value)?.text : 'Select field type...'}
          <ArrowDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Search field type..." />
          <CommandEmpty>No found.</CommandEmpty>
          <CommandGroup>
            {FIELD_CONSTANT.map(({ text, IconComponent, type }) => (
              <CommandItem
                key={type}
                value={type}
                onSelect={() => {
                  onChange?.(type);
                  setOpen(false);
                }}
              >
                <SelectIcon
                  className={classNames(
                    'mr-2 h-4 w-4',
                    value === type ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <IconComponent className="mr-2 h-4 w-4" />
                {text}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
