import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  ActionTriggerProvider,
  GroupPointProvider,
} from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { DynamicCellGraph } from '../../graph/DynamicCellGraph';
import { useCellGraphStore } from '../../graph/useCellGraphStore';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData } = props;
  const { graphOpen } = useCellGraphStore();
  const isHydrated = useIsHydrated();

  return (
    <SearchProvider>
      <ActionTriggerProvider>
        <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
          <AggregationProvider>
            <RowCountProvider>
              <GroupPointProvider>
                <GridToolBar />
                <div className="w-full grow overflow-hidden sm:pl-2">
                  {isHydrated && <GridViewBase />}
                  {graphOpen && <DynamicCellGraph />}
                </div>
              </GroupPointProvider>
            </RowCountProvider>
          </AggregationProvider>
        </RecordProvider>
      </ActionTriggerProvider>
    </SearchProvider>
  );
};
