import type { IGroupPointsVo } from '@teable/openapi';
import type { GridView } from '@teable/sdk';
import { useGridColumns } from '@teable/sdk';
import { useIsHydrated, useView, useViewId } from '@teable/sdk/hooks';
import React from 'react';
import { ViewSkeleton } from '../ViewSkeleton';
import { GridViewBaseInner } from './GridViewBaseInner';

interface IGridViewProps {
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | null };
  onRowExpand?: (recordId: string) => void;
}

const GridViewBaseLoaded: React.FC<IGridViewProps> = (props) => {
  const { groupPointsServerDataMap, onRowExpand } = props;
  const activeViewId = useViewId();
  // useGridColumns reads ComputeActivityContext revision so amber headers refresh.
  const { columns } = useGridColumns();
  if (!columns.length) {
    return <ViewSkeleton />;
  }
  return (
    <div className="relative flex size-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <GridViewBaseInner
          groupPointsServerData={groupPointsServerDataMap?.[activeViewId as string]}
          onRowExpand={onRowExpand}
        />
      </div>
    </div>
  );
};

export const GridViewBase: React.FC<IGridViewProps> = (props: IGridViewProps) => {
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const isHydrated = useIsHydrated();

  if (!isHydrated || !view) {
    return <ViewSkeleton />;
  }

  return <GridViewBaseLoaded {...props} />;
};
