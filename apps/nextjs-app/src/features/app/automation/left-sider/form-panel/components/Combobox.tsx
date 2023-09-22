import { CaretSortIcon, CheckIcon } from '@radix-ui/react-icons';
import { Plus } from '@teable-group/icons';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  // CommandInput,
  CommandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import * as React from 'react';

const configGroups = [
  {
    value: 'sendMail',
    label: 'Send email',
    icon: <Plus></Plus>,
  },
  {
    value: 'createRecord',
    label: 'Create Record',
    icon: <Plus></Plus>,
  },
  {
    value: 'updateRecord',
    label: 'Update Record',
    icon: <Plus></Plus>,
  },
  {
    value: 'findRecord',
    label: 'ReFind records',
    icon: <Plus></Plus>,
  },
  {
    value: 'runScript',
    label: 'Run script',
    icon: <Plus></Plus>,
  },
];

export function Combobox() {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between my-2"
        >
          {value
            ? configGroups.find((configGroup) => configGroup.value === value)?.label
            : 'Select configGroup...'}
          <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <Command>
          {/* <CommandInput placeholder="Search configGroup..." className="h-9" /> */}
          <CommandEmpty>No configGroup found.</CommandEmpty>
          <CommandGroup heading="airtable">
            {configGroups.map((configGroup) => (
              <CommandItem
                key={configGroup.value}
                onSelect={() => {
                  setValue(configGroup.value);
                  setOpen(false);
                }}
              >
                {configGroup.label}
                <CheckIcon
                  className={classNames(
                    'ml-auto h-4 w-4',
                    value === configGroup.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
