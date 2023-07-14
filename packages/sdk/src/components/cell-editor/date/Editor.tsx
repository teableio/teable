import { Calendar } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import dayjs from 'dayjs';
import { DateEditorMain } from './EditorMain';

export const DateEditor = (props: { value?: Date; onChange?: (value?: Date) => void }) => {
  const { value, onChange } = props;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={'outline'}
          className={classNames(
            'w-[240px] pl-3 text-left font-normal',
            !value && 'text-muted-foreground'
          )}
        >
          {value ? dayjs(value).format('YYYY-MM-DD') : <span>Pick a date</span>}
          <Calendar />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DateEditorMain value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
};
