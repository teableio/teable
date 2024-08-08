import { ChevronDown } from '@teable/icons';
import type { BaseQueryColumnType } from '@teable/openapi';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { ContextColumnsCommand } from './ContextColumnCommand';
import { useAllColumns } from './useAllColumns';

export const ContextColumnSelector = (props: {
  className?: string;
  isFilter?: boolean;
  value?: string;
  onChange: (value: string, type: BaseQueryColumnType) => void;
}) => {
  const { className, value, isFilter, onChange } = props;
  const [open, setOpen] = useState(false);
  const columns = useAllColumns(isFilter);
  const { t } = useTranslation();
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn('flex h-7 min-w-20 text-[13px] justify-between font-normal', className)}
          size={'xs'}
        >
          <span>
            {columns.find((c) => c.column === value)?.name ??
              value ??
              t('common.selectPlaceHolder')}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-full max-w-[200px] p-0">
        <ContextColumnsCommand
          isFilter={isFilter}
          onClick={(col) => {
            onChange(col.column, col.type);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
