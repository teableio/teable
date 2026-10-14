import { useIsHydrated } from '@teable/sdk/hooks';
import { GalleryPresentationView } from './components/GalleryPresentationView';
import { usePresentationMode } from './context/PresentationModeContext';
import { GalleryViewBase } from './GalleryViewBase';

export const GalleryViewContent = () => {
  const isHydrated = useIsHydrated();
  const { isPresenting } = usePresentationMode();

  return (
    <div className="w-full grow overflow-hidden">
      {isHydrated && (isPresenting ? <GalleryPresentationView /> : <GalleryViewBase />)}
    </div>
  );
};
