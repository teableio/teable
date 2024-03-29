import type { IConjunction } from '@teable/core';
import { ConjunctionSelect } from './ConjunctionSelect';

interface IConjunctionProps {
  index: number;
  value: IConjunction;
  onSelect: (value: IConjunction | null) => void;
}

enum ConjunctionPosition {
  WHERE = 0,
  SELECTOR = 1,
  JOIN = 2,
}

const Conjunction = (props: IConjunctionProps) => {
  const { index, onSelect, value } = props;

  return (
    <div className="flex w-[66px] shrink-0 justify-start">
      {index === ConjunctionPosition.WHERE ? <span className="px-1 text-sm">where</span> : null}
      {index === ConjunctionPosition.SELECTOR ? (
        <ConjunctionSelect value={value} onSelect={onSelect} />
      ) : null}
      {index >= ConjunctionPosition.JOIN ? <span className="px-1 text-[13px]">{value}</span> : null}
    </div>
  );
};

export { Conjunction };
