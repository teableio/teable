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

  const fields = useFields({ widthHidden: true });

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
          className="w-[200px] justify-between h-8"
        >
          <div className="flex justify-between w-full items-center">
            <span className="truncate">{displayName}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50 p-0.5" />
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
