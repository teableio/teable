import { Plus } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import classNames from 'classnames';
import { useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { SortFieldCommand } from './SortFieldCommand';

interface ISortFieldSelectProps {
  selectedFields?: string[];
  addBtnText?: string;
  onSelect: (colum: string) => void;
}

function SortFieldAddButton(props: ISortFieldSelectProps) {
  const { selectedFields = [], addBtnText, onSelect } = props;
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
        className={classNames('p-0', selectedFields.length > 1 ? 'min-w-[434px]' : 'min-w-[410px]')}
      >
        <SortFieldCommand onSelect={selectHandler} selectedFields={selectedFields} />
      </PopoverContent>
    </Popover>
  );
}

export { SortFieldAddButton };
