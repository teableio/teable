import { useBuildBaseAgentStore } from '@teable/sdk/components/grid-enhancements/store/useBuildBaseAgentStore';
import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  TaskStatusCollectionProvider,
} from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { usePersonalView } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const { personalViewCommonQuery, personalViewAggregationQuery } = usePersonalView();
  const { building } = useBuildBaseAgentStore();

  return (
    <SearchProvider>
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider query={personalViewAggregationQuery}>
          <TaskStatusCollectionProvider>
            <RowCountProvider query={personalViewCommonQuery}>
              <GridToolBar />
              <div
                className={cn('w-full grow overflow-hidden sm:pl-2', {
                  'rounded-md': building,
                })}
              >
                <GridViewBase groupPointsServerDataMap={groupPointsServerDataMap} />
              </div>
            </RowCountProvider>
          </TaskStatusCollectionProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
