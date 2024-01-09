/* eslint-disable @next/next/no-html-link-for-pages */
import { TeableNew } from '@teable-group/icons';
import { ActionTriggerProvider, RecordProvider } from '@teable-group/sdk/context';
import { useIsHydrated, useView } from '@teable-group/sdk/hooks';
import { useContext } from 'react';
import { ShareViewPageContext } from '../../ShareViewPageContext';
import { AggregationProvider, RowCountProvider } from './aggregation';
import { GridViewBase } from './GridViewBase';
import { Toolbar } from './toolbar';

export const GridView = () => {
  const { records } = useContext(ShareViewPageContext);
  const view = useView();
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <div className="w-full grow overflow-hidden pl-2" />;
  }

  return (
    <div className="flex h-full w-full flex-col px-3 pb-3">
      <div className="flex w-full justify-between py-3">
        <h1 className="text-lg font-semibold">{view?.name}</h1>
        <a href="/" className="flex items-center">
          <TeableNew className="text-2xl text-black" />
          <p className="ml-1 font-semibold">Teable</p>
        </a>
      </div>
      <div className="flex w-full grow flex-col overflow-hidden rounded border shadow-md">
        <Toolbar />
        <ActionTriggerProvider>
          <RecordProvider serverRecords={records}>
            <AggregationProvider>
              <RowCountProvider>
                <div className="w-full grow overflow-hidden">
                  <GridViewBase />
                </div>
              </RowCountProvider>
            </AggregationProvider>
          </RecordProvider>
        </ActionTriggerProvider>
      </div>
    </div>
  );
};
