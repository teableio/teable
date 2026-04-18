import { FilterSortStatusBar } from '@teable/sdk';
import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  TaskStatusCollectionProvider,
} from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { usePersonalView, useView, useFields } from '@teable/sdk/hooks';
import { GridToolBar } from '../tool-bar/GridToolBar';
import { useToolbarChange } from '../hooks/useToolbarChange';
import type { IViewBaseProps } from '../types';
import { GridViewBase } from './GridViewBase';

export const GridView = (props: IViewBaseProps) => {
  const { recordServerData, recordsServerData, groupPointsServerDataMap } = props;
  const { personalViewCommonQuery, personalViewAggregationQuery } = usePersonalView();
  const view = useView();
  const fields = useFields({ withHidden: true, withDenied: true });
  const { onFilterChange, onSortChange } = useToolbarChange();

  return (
    <SearchProvider>
      <RecordProvider serverRecords={recordsServerData.records} serverRecord={recordServerData}>
        <AggregationProvider query={personalViewAggregationQuery}>
          <TaskStatusCollectionProvider>
            <RowCountProvider query={personalViewCommonQuery}>
              <GridToolBar />
              <FilterSortStatusBar
                filter={view?.filter || null}
                sort={view?.sort || null}
                fields={fields}
                onFilterChange={onFilterChange}
                onSortChange={onSortChange}
              />
              <div className="w-full grow overflow-hidden sm:pl-2">
                <GridViewBase groupPointsServerDataMap={groupPointsServerDataMap} />
              </div>
            </RowCountProvider>
          </TaskStatusCollectionProvider>
        </AggregationProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
