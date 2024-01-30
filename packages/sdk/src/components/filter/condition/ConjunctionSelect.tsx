import type { IConjunction } from '@teable/core';

import { BaseSingleSelect } from '../component';

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

  return (
    <BaseSingleSelect<IConjunction, IConjunctionItem>
      value={value}
      onSelect={onSelect}
      className="m-0 h-8 min-w-full shrink-0 p-1 text-[13px]"
      search={false}
      popoverClassName="w-15"
      options={ConjunctionOptions}
    />
  );
}

export { ConjunctionSelect };
