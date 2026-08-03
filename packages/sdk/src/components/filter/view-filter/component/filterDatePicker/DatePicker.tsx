import { CalendarIcon } from '@radix-ui/react-icons';
import { Button, Calendar, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';

import * as React from 'react';
import type { SelectSingleEventHandler } from 'react-day-picker';
import { useTranslation } from '../../../../../context/app/i18n';
import type { DateField } from '../../../../../model';

interface IFilerDatePickerProps {
  value: string | null | undefined;
  field: DateField;
  onSelect: (date: string) => void;
}

function DatePicker(props: IFilerDatePickerProps) {
  const { value, onSelect, field } = props;
  const { t } = useTranslation();
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
          size="sm"
          variant={'outline'}
          className={cn(
            'w-max justify-start text-left font-normal m-1',
            !date && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className="mr-2 size-4" />
          {date ? field?.cellValue2String(date) : <span>{t('editor.date.placeholder')}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={selectHandler as SelectSingleEventHandler}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker };
