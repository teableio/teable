import type { IFilter } from '@teable-group/core';

import { BaseSingleSelect } from '../component';

interface IConjunctionItem {
  value: IFilter['conjunction'];
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
  value: IFilter['conjunction'];
  onSelect: (val: IFilter['conjunction'] | null) => void;
}

function ConjunctionSelect(props: IConjunctionSelectProps) {
  const { onSelect, value } = props;

  return (
    <BaseSingleSelect<IFilter['conjunction'], IConjunctionItem>
      value={value}
      onSelect={onSelect}
      className="h-8 p-1 text-[13px] shrink-0 m-0 min-w-full"
      search={false}
      popoverClassName="w-15"
      options={ConjunctionOptions}
    />
  );
}

export { ConjunctionSelect };
