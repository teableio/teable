import { Plus } from '@teable/icons';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';

export const NewPopover = (props: {
  className?: string;
  children: React.ReactNode | React.ReactNode[];
  addButton: {
    disabled: boolean;
  };
  onSubmit: () => void;
}) => {
  const { className, children, addButton, onSubmit } = props;
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const onAdd = () => {
    if (!addButton.disabled) {
      onSubmit();
      setOpen(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="text-[13px]" size={'xs'} variant={'outline'}>
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('min-w-80 overflow-auto', className)}>
        <div className="flex items-center justify-between gap-2">{children}</div>
        <div className="mt-2 flex justify-end">
          <Button variant={'outline'} size={'xs'} disabled={addButton.disabled} onClick={onAdd}>
            <Plus />
            {t('baseQuery.add')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
