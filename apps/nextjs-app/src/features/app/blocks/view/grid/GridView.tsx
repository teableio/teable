import { AggregationProvider, RecordProvider, RowCountProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated, usePersonalView } from '@teable/sdk/hooks';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const isHydrated = useIsHydrated();
  const { personalViewCommonQuery, personalViewAggregationQuery } = usePersonalView();

  return (
    <SearchProvider>
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider query={personalViewAggregationQuery}>
          <RowCountProvider query={personalViewCommonQuery}>
            <GridToolBar />
            {isHydrated && (
              <div className="w-full grow overflow-hidden sm:pl-2">
                <GridViewBase groupPointsServerDataMap={groupPointsServerDataMap} />
              </div>
            )}
          </RowCountProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
