import { Plus } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useState } from 'react';
import { SortFieldCommand } from './SortFieldCommand';

interface ISortFieldSelectProps {
  selectedFields?: string[];
  onSelect: (colum: string) => void;
}

function SortFieldAddButton(props: ISortFieldSelectProps) {
  const { selectedFields = [], onSelect } = props;

  const [open, setOpen] = useState(false);

  const selectHandler = (value: string) => {
    setOpen(!open);
    onSelect?.(value);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost">
          <Plus></Plus>
          <span>Add another sort</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className={classNames('p-0', selectedFields.length > 1 ? 'min-w-[434px]' : 'min-w-[410px]')}
      >
        <SortFieldCommand onSelect={selectHandler} selectedFields={selectedFields} />
      </PopoverContent>
    </Popover>
  );
}

export { SortFieldAddButton };
