import type { ISort } from '@teable/core';
import { SortBase, useSortNode } from '@teable/sdk/components';
import { isEqual } from 'lodash';
import React, { useEffect, useState } from 'react';
import { useDebounce } from 'react-use';

interface ISortProps {
  children: (text: string, isActive: boolean) => React.ReactElement;
  sorts: ISort | null;
  onChange: (sort: ISort | null) => void;
}

function Sort(props: ISortProps) {
  const { children, onChange, sorts: outerSorts } = props;

  const [innerSorts, setInnerSorts] = useState(outerSorts);

  const { text, isActive } = useSortNode(outerSorts);

  useEffect(() => {
    setInnerSorts(outerSorts);
  }, [outerSorts]);

  useDebounce(
    () => {
      if (isEqual(innerSorts, outerSorts)) {
        return;
      }
      onChange(innerSorts);
    },
    50,
    [innerSorts]
  );

  const onChangeInner = (sorts: ISort) => {
    if (sorts && !Object.hasOwnProperty.call(sorts, 'manualSort')) {
      setInnerSorts({
        sortObjs: sorts?.sortObjs || [],
        manualSort: outerSorts?.manualSort,
      });
      return;
    }
    setInnerSorts(sorts);
  };

  return (
    <SortBase sorts={innerSorts} onChange={onChangeInner} hiddenManual={true}>
      {children?.(text, isActive)}
    </SortBase>
  );
}

export { Sort };
