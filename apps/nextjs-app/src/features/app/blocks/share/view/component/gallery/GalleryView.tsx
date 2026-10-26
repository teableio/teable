import { RecordProvider, RowCountProvider, ShareViewContext } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import {
  GalleryProvider,
  PresentationModeProvider,
} from '@/features/app/blocks/view/gallery/context';
import { GalleryViewContent } from '@/features/app/blocks/view/gallery/GalleryViewContent';
import { ShareViewHeader } from '../../ShareSignInButton';
import { GalleryToolbar } from './toolbar';

export const GalleryView = () => {
  const { view } = useContext(ShareViewContext);
  const {
    query: { hideToolBar, embed },
  } = useRouter();
  return (
    <div className={cn('flex size-full flex-col', embed ? '' : 'md:px-3 md:pb-3')}>
      {!embed && <ShareViewHeader viewName={view?.name} />}
      <div className="flex w-full grow flex-col overflow-hidden border md:rounded md:shadow-md">
        <PresentationModeProvider>
          <SearchProvider>
            <RecordProvider>
              <RowCountProvider>
                {!hideToolBar && <GalleryToolbar />}
                <GalleryProvider>
                  <GalleryViewContent />
                </GalleryProvider>
              </RowCountProvider>
            </RecordProvider>
          </SearchProvider>
        </PresentationModeProvider>
      </div>
    </div>
  );
};
