import type { IConjunction } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useTranslation } from '../../../context/app/i18n';
import { BaseSingleSelect } from '../component';
import { useCompact } from '../hooks';

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
  const compact = useCompact();
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
      className={cn('m-0 h-8 min-w-full shrink-0 p-1 text-[13px]', {
        'max-w-15': compact,
        'w-15': !compact,
      })}
      search={false}
      popoverClassName="w-15"
      options={ConjunctionOptions}
    />
  );
}

export { ConjunctionSelect };
