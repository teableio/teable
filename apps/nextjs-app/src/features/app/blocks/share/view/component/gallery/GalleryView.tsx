import { RecordProvider, RowCountProvider, ShareViewContext } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { GalleryProvider } from '@/features/app/blocks/view/gallery/context';
import { GalleryViewBase } from '@/features/app/blocks/view/gallery/GalleryViewBase';
import { ShareViewHeader } from '../../ShareSignInButton';
import { GalleryToolbar } from './toolbar';

export const GalleryView = () => {
  const { view } = useContext(ShareViewContext);
  const isHydrated = useIsHydrated();
  const {
    query: { hideToolBar, embed },
  } = useRouter();
  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
      {!embed && <ShareViewHeader viewName={view?.name} />}
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
