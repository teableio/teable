import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  ActionTriggerProvider,
} from '@teable-group/sdk/context';
import { useIsHydrated } from '@teable-group/sdk/hooks';
import { DynamicGraph } from '../../graph/DynamicGraph';
import { useGraphStore } from '../../graph/useGraphStore';
import { GridToolBar } from '../tool-bar/GridToolBar';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData } = props;
  const { graphOpen } = useGraphStore();
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <div className="w-full grow overflow-hidden pl-2" />;
  }

  return (
    <ActionTriggerProvider>
      <GridToolBar />
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider>
          <RowCountProvider>
            <div className="w-full grow overflow-hidden sm:pl-2">
              <GridViewBase />
              {graphOpen && <DynamicGraph />}
            </div>
          </RowCountProvider>
        </AggregationProvider>
      </RecordProvider>
    </ActionTriggerProvider>
  );
};
