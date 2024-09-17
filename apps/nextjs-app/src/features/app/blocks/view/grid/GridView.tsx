import { AggregationProvider, RecordProvider, RowCountProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { DynamicCellGraph } from '../../graph/DynamicCellGraph';
import { useCellGraphStore } from '../../graph/useCellGraphStore';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const { graphOpen } = useCellGraphStore();
  const isHydrated = useIsHydrated();

  return (
    <SearchProvider>
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider>
          <RowCountProvider>
            <GridToolBar />
            <div className="w-full grow  sm:pl-2">
              {isHydrated && <GridViewBase groupPointsServerDataMap={groupPointsServerDataMap} />}
              {graphOpen && <DynamicCellGraph />}
            </div>
          </RowCountProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
