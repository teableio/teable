/* eslint-disable @next/next/no-html-link-for-pages */
import { TeableNew } from '@teable/icons';
import { RecordProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { EmbedFooter } from '../../EmbedFooter';
import { ShareViewPageContext } from '../../ShareViewPageContext';
import { AggregationProvider, RowCountProvider, GroupPointProvider } from './aggregation';
import { GridViewBase } from './GridViewBase';
import { Toolbar } from './toolbar';

export const GridView = () => {
  const { records, view } = useContext(ShareViewPageContext);
  const isHydrated = useIsHydrated();
  const {
    query: { hideToolBar, embed },
  } = useRouter();

  return (
    <div className="flex size-full flex-col md:px-3 md:pb-3">
      {!embed && (
        <div className="flex w-full justify-between px-1 py-2 md:px-0 md:py-3">
          <h1 className="font-semibold md:text-lg">{view?.name}</h1>
          <a href="/" className="flex items-center">
            <TeableNew className="text-black md:text-2xl" />
            <p className="ml-1 font-semibold">Teable</p>
          </a>
        </div>
      )}
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <SearchProvider>
          <RecordProvider serverRecords={records}>
            <AggregationProvider>
              <RowCountProvider>
                <GroupPointProvider>
                  {!hideToolBar && <Toolbar />}
                  <div className="w-full grow overflow-hidden">
                    {isHydrated && <GridViewBase />}
                  </div>
                  {embed && <EmbedFooter />}
                </GroupPointProvider>
              </RowCountProvider>
            </AggregationProvider>
          </RecordProvider>
        </SearchProvider>
      </div>
    </div>
  );
};
