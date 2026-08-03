import { RecordProvider, RowCountProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { useIsHydrated, usePersonalView } from '@teable/sdk/hooks';
import { GalleryToolBar } from '../tool-bar/GalleryToolBar';
import { GalleryProvider } from './context';
import { GalleryViewBase } from './GalleryViewBase';

export const GalleryView = () => {
  const isHydrated = useIsHydrated();
  const { personalViewCommonQuery } = usePersonalView();

  return (
    <SearchProvider>
      <RecordProvider>
        <RowCountProvider query={personalViewCommonQuery}>
          <GalleryToolBar />
          <GalleryProvider>
            <div className="w-full grow overflow-hidden">{isHydrated && <GalleryViewBase />}</div>
          </GalleryProvider>
        </RowCountProvider>
      </RecordProvider>
    </SearchProvider>
  );
};
