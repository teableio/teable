import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useTranslation } from '../../context/app/i18n';
import { FilterMain } from './FilterMain';
import type { IFilterBaseProps } from './types';

function FilterBase(props: IFilterBaseProps) {
  const { filters, children, contentHeader } = props;
  const { t } = useTranslation();
  const title = t('filter.tips.scope');
  const emptyText = t('filter.default.empty');

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
            <div className="px-4 pt-4">{title}</div>
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
