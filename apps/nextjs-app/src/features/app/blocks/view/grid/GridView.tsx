import { AggregationProvider, RecordProvider, RowCountProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { DynamicCellGraph } from '../../graph/DynamicCellGraph';
import { useCellGraphStore } from '../../graph/useCellGraphStore';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';
import { isSafari } from './utils/copyAndPaste';

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
            {isHydrated && (
              <div
                className={cn('w-full grow sm:pl-2 overflow-hidden', isSafari() && 'pb-20 sm:pb-0')}
              >
                <GridViewBase groupPointsServerDataMap={groupPointsServerDataMap} />
                {graphOpen && <DynamicCellGraph />}
              </div>
            )}
          </RowCountProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
