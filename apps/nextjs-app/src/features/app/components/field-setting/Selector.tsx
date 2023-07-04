import ArrowDownIcon from '@teable-group/ui-lib/icons/app/arrow-down.svg';
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
import { useRef, useState } from 'react';

type IProps<T = { id: string; name: string; icon?: React.ReactNode }> = {
  selectedId?: string;
  placeholder?: string;
  candidates?: T[];
  onChange?: (id: string) => void;
};

export const Selector: React.FC<IProps> = (props) => {
  const { selectedId = '', onChange, candidates = [] } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          disabled={!candidates.length}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selectedId ? candidates.find(({ id }) => id === selectedId)?.name : ''}
          <ArrowDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" style={{ width: ref.current?.offsetWidth }}>
        <Command>
          <CommandInput placeholder="Find a field..." />
          <CommandEmpty>No found.</CommandEmpty>
          <CommandGroup>
            {candidates.map(({ id, name, icon }) => (
              <CommandItem
                key={id}
                value={id}
                onSelect={() => {
                  onChange?.(id);
                  setOpen(false);
                }}
              >
                <SelectIcon
                  className={classNames(
                    'mr-2 h-4 w-4',
                    id === selectedId ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {icon} <span className="ml-2">{name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
