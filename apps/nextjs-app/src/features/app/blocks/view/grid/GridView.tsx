import { AggregationProvider, RecordProvider } from '@teable-group/sdk/context';
import { RowCountProvider } from '@teable-group/sdk/context/aggregation/RowCountProvider';
import { useIsHydrated } from '@teable-group/sdk/hooks';
import { Skeleton } from '@teable-group/ui-lib/shadcn';
import dynamic from 'next/dynamic';
import { useGraphStore } from '../../graph/useGraphStore';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

const Graph = dynamic(() => import('../../graph/Graph').then<React.FC>((mod) => mod.Graph), {
  loading: () => (
    <div className="absolute right-10 top-20 w-96 space-y-2 rounded border bg-background p-4 shadow">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-6 w-full" />
    </div>
  ),
  ssr: false,
});

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData } = props;
  const { graphOpen } = useGraphStore();
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <div className="w-full grow overflow-hidden pl-2" />;
  }

  return (
    <AggregationProvider>
      <GridToolBar />
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <RowCountProvider>
          <div className="w-full grow overflow-hidden sm:pl-2">
            <GridViewBase />
            {graphOpen && <Graph />}
          </div>
        </RowCountProvider>
      </RecordProvider>
    </AggregationProvider>
  );
};
