import { CalendarIcon } from '@radix-ui/react-icons';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Calendar } from '@teable-group/ui-lib/shadcn/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import { format } from 'date-fns';

import * as React from 'react';
import type { SelectSingleEventHandler } from 'react-day-picker';
import { cn } from '@/lib/utils';

interface IFilerDatePickerProps {
  value: string | null | undefined;
  onSelect: (date: string) => void;
}

function DatePicker(props: IFilerDatePickerProps) {
  const { value, onSelect } = props;
  const [open, setOpen] = React.useState(false);
  const date = React.useMemo(() => {
    if (value) {
      return new Date(value);
    }
  }, [value]);

  const selectHandler = (date: Date) => {
    onSelect?.(date.toISOString());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={'outline'}
          className={cn(
            'w-max justify-start text-left font-normal m-1',
            !date && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, 'PPP') : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={selectHandler as SelectSingleEventHandler}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
