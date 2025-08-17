import { CalendarIcon } from '@radix-ui/react-icons';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';

interface IExpirationSelect {
  onChange?: (value: string | undefined) => void;
}

export const ExpirationSelect = (props: IExpirationSelect) => {
  const { onChange } = props;
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [date, setDate] = useState<Date>();
  const { t } = useTranslation('token');

  const options = useMemo(() => {
    return [
      {
        label: `7 ${t('new.expirationList.days')}`,
        value: '7',
      },
      {
        label: `30 ${t('new.expirationList.days')}`,
        value: '30',
      },
      {
        label: `60 ${t('new.expirationList.days')}`,
        value: '60',
      },
      {
        label: `90 ${t('new.expirationList.days')}`,
        value: '90',
      },
      {
        label: t('new.expirationList.permanent'),
        value: 'permanent',
      },
      {
        label: t('new.expirationList.custom'),
        value: '-1',
      },
    ];
  }, [t]);

  const onValueChange = (value: string) => {
    setDate(undefined);
    setIsCustom(false);
    if (value === '-1') {
      setIsCustom(true);
      return;
    }
    if (value === 'permanent') {
      onChange?.(dayjs('2099-12-31').format('YYYY-MM-DD'));
      return;
    }
    onChange?.(dayjs().add(Number(value), 'day').format('YYYY-MM-DD'));
  };

  const onDateChange = (date: Date | undefined) => {
    setDate(date);
    onChange?.(date ? dayjs(date).format('YYYY-MM-DD') : undefined);
  };

  return (
    <div className="flex gap-6">
      <Select onValueChange={onValueChange}>
        <SelectTrigger className="h-8 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(({ label, value }) => {
            return (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {isCustom && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={'outline'}
              size={'sm'}
              className={cn(
                'w-[240px] justify-start text-left font-normal',
                !date && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 size-4" />
              {date ? (
                new Date(date).toLocaleDateString()
              ) : (
                <span>{t('new.expirationList.pick')}</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={date}
              onSelect={onDateChange}
              fromYear={new Date().getFullYear()}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
