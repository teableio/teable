import type { IGroupPointsVo } from '@teable/openapi';
import type { GridView } from '@teable/sdk';
import { useGridColumns } from '@teable/sdk';
import { useView, useViewId } from '@teable/sdk/hooks';
import { Skeleton } from '@teable/ui-lib';
import React, { useState } from 'react';
import { useMount } from 'react-use';
import { GridViewBaseInner } from './GridViewBaseInner';

interface IGridViewProps {
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | undefined };
  onRowExpand?: (recordId: string) => void;
}

export const GridViewBase: React.FC<IGridViewProps> = (props: IGridViewProps) => {
  const { groupPointsServerDataMap, onRowExpand } = props;
  const activeViewId = useViewId();
  const view = useView(activeViewId) as GridView | undefined;
  const { columns } = useGridColumns();
  const [isReadyToRender, setReadyToRender] = useState(false);
  const isLoading = !view || !columns.length;

  useMount(() => setReadyToRender(true));

  return (
    <>
      {isReadyToRender && !isLoading ? (
        <GridViewBaseInner
          groupPointsServerData={groupPointsServerDataMap?.[activeViewId as string]}
          onRowExpand={onRowExpand}
        />
      ) : (
        <div className="relative size-full overflow-hidden">
          <div className="flex w-full items-center space-x-4">
            <div className="w-full space-y-3 px-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
