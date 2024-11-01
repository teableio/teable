/* eslint-disable @next/next/no-html-link-for-pages */
import { TeableNew } from '@teable/icons';
import { RecordProvider, RowCountProvider, ShareViewContext } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { GalleryProvider } from '@/features/app/blocks/view/gallery/context';
import { GalleryViewBase } from '@/features/app/blocks/view/gallery/GalleryViewBase';
import { GalleryToolbar } from './toolbar';

export const GalleryView = () => {
  const { view } = useContext(ShareViewContext);
  const isHydrated = useIsHydrated();
  const {
    query: { hideToolBar, embed },
  } = useRouter();

  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
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
          <RecordProvider>
            <RowCountProvider>
              {!hideToolBar && <GalleryToolbar />}
              <GalleryProvider>
                <div className="w-full grow overflow-hidden">
                  {isHydrated && <GalleryViewBase />}
                </div>
              </GalleryProvider>
            </RowCountProvider>
          </RecordProvider>
        </SearchProvider>
      </div>
    </div>
  );
};
