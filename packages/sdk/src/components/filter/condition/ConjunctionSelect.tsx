import type { IConjunction } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../../context/app/i18n';
import { BaseSingleSelect } from '../view-filter/component/base/BaseSingleSelect';

interface IConjunctionItem {
  value: IConjunction;
  label: string;
}

interface IConjunctionSelectProps {
  value: IConjunction;
  onSelect: (val: IConjunction | null) => void;
  /**
   * Extra trigger classes. Only pass shrink-related classes from a *row*
   * container: this trigger sets `overflow-hidden`, which drops its automatic
   * minimum size to 0, so a bare `shrink` inside the filter's column layout
   * collapses it to zero height instead of letting it shrink sideways.
   */
  className?: string;
}

function ConjunctionSelect(props: IConjunctionSelectProps) {
  const { onSelect, value, className } = props;
  const { t } = useTranslation();

  const ConjunctionOptions: IConjunctionItem[] = [
    {
      value: 'and',
      label: t('filter.conjunction.meetingAll'),
    },
    {
      value: 'or',
      label: t('filter.conjunction.meetingAny'),
    },
  ];

  return (
    <BaseSingleSelect<IConjunction, IConjunctionItem>
      value={value}
      onSelect={onSelect}
      className={cn(
        'h-6 w-fit shrink-0 min-w-fit border-0 p-0 text-[13px]',
        'shadow-none text-muted-foreground justify-start gap-0 cursor-pointer',
        'bg-transparent dark:bg-transparent hover:bg-transparent dark:hover:bg-transparent hover:text-foreground',
        'focus-visible:ring-0 focus-visible:ring-offset-0',
        className
      )}
      search={false}
      popoverClassName="w-auto"
      drawerTitle={t('filter.selectConjunction')}
      options={ConjunctionOptions}
    />
  );
}

export { ConjunctionSelect };
