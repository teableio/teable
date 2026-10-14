import { Plus } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import { useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import type { IFieldInstance } from '../../model';
import { NestedDrawer, useInDrawer } from '../adaptive-panel';
import { FieldCommand } from '../field/FieldCommand';

interface ISortFieldSelectProps {
  fields: IFieldInstance[];
  selectedFieldIds?: string[];
  addBtnText?: string;
  onSelect: (colum: string) => void;
}

function SortFieldAddButton(props: Readonly<ISortFieldSelectProps>) {
  const { fields, selectedFieldIds = [], addBtnText, onSelect } = props;
  const { t } = useTranslation();
  const inDrawer = useInDrawer();
  const [open, setOpen] = useState(false);

  const selectHandler = (value: string) => {
    setOpen(!open);
    onSelect?.(value);
  };

  const trigger = (
    <Button
      variant="outline"
      size={'sm'}
      className={cn('ms-4', inDrawer && 'ms-0 w-full justify-center')}
    >
      <Plus className="size-4"></Plus>
      <span className="truncate">{addBtnText ?? t('sort.addButton')}</span>
    </Button>
  );

  const fieldCommand = (
    <FieldCommand fields={fields} onSelect={selectHandler} selectedIds={selectedFieldIds} />
  );

  if (inDrawer) {
    return (
      <NestedDrawer
        open={open}
        onOpenChange={setOpen}
        title={t('common.selectField')}
        size="list"
        content={fieldCommand}
      >
        {trigger}
      </NestedDrawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      <PopoverContent
        className={cn('p-0', selectedFieldIds.length > 1 ? 'min-w-[434px]' : 'min-w-[410px]')}
      >
        {fieldCommand}
      </PopoverContent>
    </Popover>
  );
}

export { SortFieldAddButton };
