import { FieldType } from '@teable-group/core';
import { useFieldStaticGetter } from '@teable-group/sdk';
import ArrowDownIcon from '@teable-group/ui-lib/icons/app/arrow-down.svg';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@teable-group/ui-lib/shadcn/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import classNames from 'classnames';
import { useState, useRef } from 'react';
import { FIELD_TYPE_ORDER } from '../../utils/fieldTypeOrder';

export const SelectFieldType = (props: {
  value?: FieldType;
  isLookup?: boolean;
  onChange?: (type: FieldType | 'lookup') => void;
}) => {
  const { value = FieldType.SingleLineText, isLookup, onChange } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const getFieldStatic = useFieldStaticGetter();
  const { Icon, title } = getFieldStatic(value, isLookup) || {};

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-start font-normal"
        >
          {Icon && <Icon />}
          <span className="grow text-left ml-2">{isLookup ? 'Lookup to other table' : title}</span>
          <ArrowDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" style={{ width: ref.current?.offsetWidth }}>
        <Command>
          <CommandInput placeholder="Search field type..." />
          <CommandEmpty>No found.</CommandEmpty>
          <CommandGroup>
            {FIELD_TYPE_ORDER.map((type) => {
              const { title, Icon } = getFieldStatic(type, false);
              return (
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
                      !isLookup && value === type ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <Icon className="mr-2 h-4 w-4" />
                  {title}
                </CommandItem>
              );
            })}
            <CommandItem
              key={'lookup'}
              value={'lookup'}
              onSelect={() => {
                onChange?.('lookup');
                setOpen(false);
              }}
            >
              <SelectIcon
                className={classNames('mr-2 h-4 w-4', isLookup ? 'opacity-100' : 'opacity-0')}
              />
              <SearchIcon className="mr-2 h-4 w-4" />
              Lookup to other table
            </CommandItem>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
