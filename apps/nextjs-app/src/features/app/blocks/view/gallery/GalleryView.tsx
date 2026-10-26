import { RecordProvider, RowCountProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { usePersonalView } from '@teable/sdk/hooks';
import { GalleryToolBar } from '../tool-bar/GalleryToolBar';
import { GalleryProvider, PresentationModeProvider } from './context';
import { GalleryViewContent } from './GalleryViewContent';

export const GalleryView = () => {
  const { personalViewCommonQuery } = usePersonalView();

  return (
    <PresentationModeProvider>
      <SearchProvider>
        <RecordProvider>
          <RowCountProvider query={personalViewCommonQuery}>
            <GalleryToolBar />
            <GalleryProvider>
              <GalleryViewContent />
            </GalleryProvider>
          </RowCountProvider>
        </RecordProvider>
      </SearchProvider>
    </PresentationModeProvider>
  );
};
