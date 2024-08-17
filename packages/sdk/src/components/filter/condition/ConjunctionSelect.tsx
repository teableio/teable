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
      label: t('filter.conjunction.and'),
    },
    {
      value: 'or',
      label: t('filter.conjunction.or'),
    },
  ];

  return (
    <BaseSingleSelect<IConjunction, IConjunctionItem>
      value={value}
      onSelect={onSelect}
      className={cn('h-8 min-w-full shrink-0 p-1 text-[13px]')}
      search={false}
      popoverClassName="w-15"
      options={ConjunctionOptions}
    />
  );
}

export { ConjunctionSelect };
