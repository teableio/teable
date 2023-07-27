import type { IFilter } from '@teable-group/core';
import { cloneDeep } from 'lodash';
import { ConjunctionSelect } from './ConjunctionSelect';

interface IConjunctionProps {
  index: number;
  parent: IFilter;
  filters: IFilter | null;
  setFilter: (val: IFilter | null) => void;
}

enum ConjunctionPosition {
  WHERE = 0,
  SELECTOR = 1,
  JOIN = 1,
}

const Conjunction = (props: IConjunctionProps) => {
  const { index, parent, setFilter, filters } = props;

  const onSelect = (val: IFilter['conjunction']) => {
    parent.conjunction = val;
    const newFilters = cloneDeep(filters);
    setFilter(newFilters);
  };

  return (
    <div className="p-r-2 min-w-[60px] m-1">
      {index === ConjunctionPosition.WHERE ? <span className="px-1 text-sm">where</span> : null}
      {index === ConjunctionPosition.SELECTOR ? (
        <ConjunctionSelect value={parent.conjunction} onSelect={onSelect} />
      ) : null}
      {index > ConjunctionPosition.JOIN ? (
        <span className="px-1 text-[13px]">{parent.conjunction}</span>
      ) : null}
    </div>
  );
};

export { Conjunction };
