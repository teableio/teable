import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { SINGLE_SELECT_OPERATORS } from './constant';
import { DefaultList } from './DefaultList';
import { DefaultTrigger } from './DefaultTrigger';
import type { IFilterLinkProps, IFilterLinkSelectListProps } from './types';

interface FilterLinkSelectProps extends IFilterLinkProps {
  components?: {
    Trigger?: (props: IFilterLinkProps) => JSX.Element;
    List?: (value: IFilterLinkSelectListProps) => JSX.Element;
  };
  modal?: boolean;
}

export const FilterLinkSelect = (props: FilterLinkSelectProps) => {
  const { value, operator, onSelect, components, className, modal } = props;
  const { Trigger, List } = components || {};
  const [open, setOpen] = useState(false);

  const InnerTrigger = Trigger ?? DefaultTrigger;
  const InnerSelector = List ?? DefaultList;

  const onListClick = (recordId: string) => {
    const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    const firstValue = values[0];

    if (!SINGLE_SELECT_OPERATORS.includes(operator)) {
      values.includes(recordId)
        ? onSelect(values.filter((id) => id !== recordId))
        : onSelect([...values, recordId]);
    } else {
      setOpen(false);
      onSelect(firstValue === recordId ? null : recordId);
    }
  };

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen} modal={modal}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size={'sm'}
            className={cn('w-40 justify-between overflow-auto px-2', className)}
          >
            <div className="flex flex-1 gap-1 overflow-hidden">
              <InnerTrigger {...props} />
            </div>
            <ChevronDown
              className={cn(
                'ml-2 size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                open && 'rotate-180'
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="h-[350px] w-screen md:w-[480px]">
          <InnerSelector {...props} onClick={onListClick} />
        </PopoverContent>
      </Popover>
    </div>
  );
};
