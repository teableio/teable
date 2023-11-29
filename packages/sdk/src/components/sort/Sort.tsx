import { useMutation } from '@tanstack/react-query';
import type { ISort, IManualSortRo } from '@teable-group/core';
import { isEqual } from 'lodash';
import React, { useEffect, useRef, useState } from 'react';
import { useDebounce } from 'react-use';
import { useTableId, useViewId } from '../../hooks';
import { View } from '../../model';
import type { ISortBaseRef } from './SortBase';
import { SortBase } from './SortBase';

interface ISortProps {
  children: (text: string, isActive: boolean) => React.ReactElement;
  sorts: ISort | null;
  onChange: (sort: ISort | null) => void;
}

function Sort(props: ISortProps) {
  const { children, onChange, sorts: outerSorts } = props;
  const sortBaseRef = useRef<ISortBaseRef>(null);

  const tableId = useTableId();

  const viewId = useViewId();

  const [innerSorts, setInnerSorts] = useState(outerSorts);

  const { mutateAsync, isLoading } = useMutation({
    mutationFn: async ({
      tableId,
      viewId,
      viewRo,
    }: {
      tableId: string;
      viewId: string;
      viewRo: IManualSortRo;
    }) => {
      return (await View.manualSort(tableId, viewId, viewRo)).data;
    },
    onSuccess: () => {
      sortBaseRef.current?.close();
    },
  });

  const sortButtonText =
    !innerSorts?.manualSort && innerSorts?.sortObjs?.length
      ? `Sort By ${innerSorts?.sortObjs?.length} filed${
          innerSorts?.sortObjs?.length > 1 ? 's' : ''
        }`
      : 'Sort';

  useEffect(() => {
    // async from sharedb
    setInnerSorts(outerSorts);
  }, [outerSorts]);

  useDebounce(
    () => {
      /**
       * there only following scenarios to update
       * 1. only switch the manualSort
       * 2. only manualSort is true
       */
      if (isEqual(innerSorts, outerSorts)) {
        return;
      }

      const onlyAutoSortChange =
        isEqual(outerSorts?.sortObjs, innerSorts?.sortObjs) &&
        outerSorts?.manualSort !== innerSorts?.manualSort;

      if (onlyAutoSortChange) {
        onChange(innerSorts);
        return;
      }

      if (!innerSorts && outerSorts?.manualSort) {
        onChange(innerSorts);
        return;
      }

      !innerSorts?.manualSort && onChange(innerSorts);
    },
    50,
    [innerSorts]
  );

  const manualSort = async () => {
    if (innerSorts?.sortObjs?.length) {
      const viewRo: IManualSortRo = {
        sortObjs: innerSorts.sortObjs,
      };
      if (tableId && viewId) {
        mutateAsync({ tableId, viewId, viewRo });
      }
    }
  };

  const onChangeInner = (sorts: ISort | null) => {
    if (sorts == null) return setInnerSorts(null);
    if (!Object.hasOwnProperty.call(sorts, 'manualSort')) {
      setInnerSorts({
        sortObjs: sorts?.sortObjs || [],
        manualSort: outerSorts?.manualSort,
      });
      return;
    }
    setInnerSorts(sorts);
  };

  return (
    <SortBase
      ref={sortBaseRef}
      sorts={innerSorts}
      manualSortLoading={isLoading}
      onChange={onChangeInner}
      manualSortOnClick={manualSort}
    >
      {children?.(sortButtonText, sortButtonText !== 'Sort')}
    </SortBase>
  );
}

export { Sort };
