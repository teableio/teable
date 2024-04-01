import { Plus } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import { useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { FieldCommand } from '../field/FieldCommand';

interface ISortFieldSelectProps {
  selectedFieldIds?: string[];
  addBtnText?: string;
  onSelect: (colum: string) => void;
}

function SortFieldAddButton(props: ISortFieldSelectProps) {
  const { selectedFieldIds = [], addBtnText, onSelect } = props;
  const { t } = useTranslation();
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
          <span>{addBtnText ?? t('sort.addButton')}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className={cn('p-0', selectedFieldIds.length > 1 ? 'min-w-[434px]' : 'min-w-[410px]')}
      >
        <FieldCommand onSelect={selectHandler} selectedIds={selectedFieldIds} />
      </PopoverContent>
    </Popover>
  );
}

export { SortFieldAddButton };
