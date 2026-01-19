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
}

function ConjunctionSelect(props: IConjunctionSelectProps) {
  const { onSelect, value } = props;
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
        'focus-visible:ring-0 focus-visible:ring-offset-0'
      )}
      search={false}
      popoverClassName="w-auto"
      options={ConjunctionOptions}
    />
  );
}

export { ConjunctionSelect };
