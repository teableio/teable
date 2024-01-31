import { Check, ChevronDown } from '@teable/icons';
import { useMemo, useRef, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  cn,
  CommandInput,
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from '../../shadcn';

export interface ISelectorItem {
  id: string;
  name: string;
  icon?: React.ReactNode;
}

export type ISelectorProps<T = ISelectorItem> = {
  className?: string;
  contentClassName?: string;
  readonly?: boolean;
  selectedId?: string;
  placeholder?: string;
  searchTip?: string;
  emptyTip?: string;
  defaultName?: string;
  candidates?: T[];
  onChange?: (id: string) => void;
};

export const Selector: React.FC<ISelectorProps> = ({
  onChange,
  readonly,
  selectedId = '',
  placeholder,
  searchTip = 'Search...',
  emptyTip = 'No found.',
  defaultName = 'Untitled',
  className,
  contentClassName,
  candidates = [],
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const candidatesMap = useMemo(
    () =>
      candidates.reduce(
        (pre, cur) => {
          pre[cur.id?.toLowerCase()] = cur;
          return pre;
        },
        {} as Record<string, ISelectorItem>
      ),
    [candidates]
  );
  const selected = candidatesMap[selectedId.toLowerCase()];

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          disabled={readonly || !candidates.length}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('flex gap-2 font-normal px-4', className)}
        >
          {selected ? (
            <>
              {selected.icon}
              <span className="text-ellipsis whitespace-nowrap overflow-hidden">
                {selected.name}
              </span>
            </>
          ) : (
            <span className="shrink-0">{placeholder}</span>
          )}
          <div className="grow"></div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-full p-0', contentClassName)}
        style={{ minWidth: ref.current?.offsetWidth }}
      >
        <Command
          filter={(value, search) => {
            if (!search) return 1;
            // cmdk bugs value is always lowercase, sucks...
            const item = candidatesMap[value];
            const text = item?.name || item?.id;
            if (text?.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return 1;
            return 0;
          }}
        >
          <CommandInput placeholder={searchTip} />
          <CommandEmpty>{emptyTip}</CommandEmpty>
          <CommandList>
            {candidates.map(({ id, name, icon }) => (
              <CommandItem
                key={id}
                value={id}
                onSelect={() => {
                  onChange?.(id);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn('mr-2 h-4 w-4', id === selectedId ? 'opacity-100' : 'opacity-0')}
                />
                {icon} <span className="ml-2">{name ? name : defaultName}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
