import { AggregationProvider, RecordProvider, RowCountProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const isHydrated = useIsHydrated();

  return (
    <SearchProvider>
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider>
          <RowCountProvider>
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
