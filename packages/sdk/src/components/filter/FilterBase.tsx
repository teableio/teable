import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';

import { FilterMain } from './FilterMain';
import type { IFilterBaseProps } from './types';

function FilterBase(props: IFilterBaseProps) {
  const { filters, children, contentHeader } = props;
  const title = 'In this view, show records';
  const emptyText = 'No filter conditions are applied';

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-min min-w-[544px] max-w-screen-md p-0"
      >
        {contentHeader}
        <div className="text-[13px]">
          {filters?.filterSet?.length ? (
            <div className="px-4 pt-3">{title}</div>
          ) : (
            <div className="px-4 pt-4 text-muted-foreground">{emptyText}</div>
          )}
        </div>
        <FilterMain {...props} />
      </PopoverContent>
    </Popover>
  );
}

export { FilterBase };
