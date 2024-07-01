import type { IConjunction } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { BaseSingleSelect } from '../component';
import { useCompact } from '../hooks';

interface IConjunctionItem {
  value: IConjunction;
  label: string;
}

const ConjunctionOptions: IConjunctionItem[] = [
  {
    value: 'and',
    label: 'and',
  },
  {
    value: 'or',
    label: 'or',
  },
];

interface IConjunctionSelectProps {
  value: IConjunction;
  onSelect: (val: IConjunction | null) => void;
}

function ConjunctionSelect(props: IConjunctionSelectProps) {
  const { onSelect, value } = props;
  const compact = useCompact();

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
