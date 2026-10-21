import {
  AggregationProvider,
  RecordProvider,
  RowCountProvider,
  ShareViewContext,
} from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { EmbedFooter } from '../../EmbedFooter';
import { ShareViewHeader } from '../../ShareSignInButton';
import { GridViewBase } from './GridViewBase';
import { Toolbar } from './toolbar';

export const GridView = () => {
  const { records, view, extra } = useContext(ShareViewContext);
  const isHydrated = useIsHydrated();
  const {
    query: { hideToolBar, embed },
  } = useRouter();

  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
      {!embed && <ShareViewHeader viewName={view?.name} />}
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <SearchProvider>
          <RecordProvider serverRecords={records}>
            <AggregationProvider>
              <RowCountProvider>
                {!hideToolBar && <Toolbar />}
                {isHydrated && (
                  <div className="w-full grow overflow-hidden">
                    <GridViewBase groupPointsServerData={extra?.groupPoints} />
                  </div>
                )}
                {embed && <EmbedFooter />}
              </RowCountProvider>
            </AggregationProvider>
          </RecordProvider>
        </SearchProvider>
      </div>
    </div>
  );
};
