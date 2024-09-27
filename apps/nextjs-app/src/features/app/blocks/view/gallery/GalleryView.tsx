import { GroupPointProvider, RecordProvider } from '@teable/sdk/context';
import { SearchProvider } from '@teable/sdk/context/query';
import { GalleryToolBar } from '../tool-bar/GalleryToolBar';
import { GalleryViewBase } from './GalleryViewBase';

export const GalleryView = () => {
  return (
    <>
      <SearchProvider>
        <RecordProvider>
          <GroupPointProvider>
            <GalleryToolBar />
            <GalleryViewBase />
          </GroupPointProvider>
        </RecordProvider>
      </SearchProvider>
    </>
  );
};
