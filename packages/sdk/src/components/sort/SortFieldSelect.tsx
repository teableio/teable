import { Button, Popover, PopoverTrigger, PopoverContent } from '@teable-group/ui-lib';
import { ChevronsUpDown } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useFields } from '../../hooks';
import { SortFieldCommand } from './SortFieldCommand';

interface ISortFieldSelect {
  value: string;
  selectedFields?: string[];
  onSelect?: (value: string) => void;
}

function SortFieldSelect(props: ISortFieldSelect) {
  const { value, selectedFields, onSelect } = props;

  const [open, setOpen] = useState(false);

  const fields = useFields({ withHidden: true });

  const displayName = useMemo(() => {
    const map: Record<string, string> = {};
    fields.forEach((field) => {
      map[field.id] = field.name;
    });
    return map[value];
  }, [fields, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-[200px] justify-between"
        >
          <div className="flex w-full items-center justify-between">
            <span className="truncate">{displayName}</span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 p-0.5 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[200px] p-0">
        <SortFieldCommand selectedFields={selectedFields} onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  );
}

export { SortFieldSelect };
