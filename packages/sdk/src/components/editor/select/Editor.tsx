import { Plus } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import { useState } from 'react';
import type { ISelectEditorMain } from './EditorMain';
import { SelectEditorMain } from './EditorMain';
import { SelectTag } from './SelectTag';

export const SelectEditor = <T extends boolean = false>(props: ISelectEditorMain<T>) => {
  const { value, options = [], isMultiple } = props;
  const [open, setOpen] = useState(false);

  const displayOptions = options.filter((option) =>
    isMultiple ? value?.includes(option.value) : value === option.value
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="grid grid-cols-4 gap-4">
          {displayOptions.map(({ value, label, backgroundColor, color }) => (
            <SelectTag key={value} label={label} color={color} backgroundColor={backgroundColor} />
          ))}
          <Button variant={'ghost'} size={'sm'}>
            <Plus />
          </Button>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <SelectEditorMain {...props} />
      </PopoverContent>
    </Popover>
  );
};
