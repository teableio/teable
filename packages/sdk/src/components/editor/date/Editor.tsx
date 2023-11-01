import { TimeFormatting, type IDateFieldOptions } from '@teable-group/core';
import { Calendar } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import type { IDateEditorMain } from './EditorMain';
import { DateEditorMain } from './EditorMain';

export interface IDateEditor extends IDateEditorMain {
  options?: IDateFieldOptions;
}

export const DateEditor = (props: IDateEditor) => {
  const { value, onChange, className, disabled, options } = props;
  const { date, time } = options?.formatting || {};

  const valueComponent = useMemo(() => {
    if (!value) return <span>Pick a date</span>;

    let format = 'YYYY-MM-DD HH:mm';
    if (date && time) {
      format = time === TimeFormatting.None ? date : `${date} ${time}`;
    }
    return dayjs(value).format(format);
  }, [value, date, time]);

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant={'outline'}
          className={classNames(
            'w-full first-line:pl-3 text-left font-normal h-10 sm:h-9',
            !value && 'text-muted-foreground',
            className
          )}
        >
          {valueComponent}
          <Calendar />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DateEditorMain value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
};
