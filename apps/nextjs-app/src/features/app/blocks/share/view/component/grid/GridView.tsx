import { FilterSortStatusBar } from '@teable/sdk';
import { RecordProvider, RowCountProvider, ShareViewContext } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useFields, useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { TeableLogo } from '@/components/TeableLogo';
import { useToolbarChange } from '@/features/app/blocks/view/hooks/useToolbarChange';
import { useBrand } from '@/features/app/hooks/useBrand';
import { EmbedFooter } from '../../EmbedFooter';
import { AggregationProvider } from './aggregation';
import { GridViewBase } from './GridViewBase';
import { Toolbar } from './toolbar';

export const GridView = () => {
  const { records, view, extra } = useContext(ShareViewContext);
  const isHydrated = useIsHydrated();
  const fields = useFields({ withHidden: true, withDenied: true });
  const { brandName } = useBrand();
  const { onFilterChange, onSortChange } = useToolbarChange();
  const {
    query: { hideToolBar, embed },
  } = useRouter();

  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
      {!embed && (
        <div className="flex w-full justify-between px-1 py-2 md:px-0 md:py-3">
          <h1 className="font-semibold md:text-lg">{view?.name}</h1>
          <Link href="/" className="flex items-center">
            <TeableLogo className="md:text-2xl" />
            <p className="ml-1 font-semibold">{brandName}</p>
          </Link>
        </div>
      )}
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <SearchProvider>
          <RecordProvider serverRecords={records}>
            <AggregationProvider>
              <RowCountProvider>
                {!hideToolBar && <Toolbar />}
                <FilterSortStatusBar
                  filter={view?.filter || null}
                  sort={view?.sort || null}
                  fields={fields}
                  onFilterChange={onFilterChange}
                  onSortChange={onSortChange}
                />
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
