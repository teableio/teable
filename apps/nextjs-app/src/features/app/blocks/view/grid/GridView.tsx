import { ComputeActivityProvider } from '@teable/sdk';
import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  TaskStatusCollectionProvider,
} from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { usePersonalView } from '@teable/sdk/hooks';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const { isPersonalView, personalViewCommonQuery, personalViewAggregationQuery } =
    usePersonalView();

  // SSR/seed records are fetched with the shared view's query — a personal
  // view's filter/sort/group would make them wrong (e.g. transiently showing
  // rows the personal filter hides), so let the subscription deliver instead
  const serverRecords = isPersonalView ? undefined : recordsServerData.records;
  const serverGroupPointsMap = isPersonalView ? undefined : groupPointsServerDataMap;

  return (
    <SearchProvider>
      <RecordProvider serverRecords={serverRecords} serverRecord={recordServerData}>
        <AggregationProvider query={personalViewAggregationQuery}>
          <TaskStatusCollectionProvider>
            <RowCountProvider query={personalViewCommonQuery}>
              <ComputeActivityProvider>
                <GridToolBar />
                <div className="w-full grow overflow-hidden sm:ps-2">
                  <GridViewBase groupPointsServerDataMap={serverGroupPointsMap} />
                </div>
              </ComputeActivityProvider>
            </RowCountProvider>
          </TaskStatusCollectionProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
