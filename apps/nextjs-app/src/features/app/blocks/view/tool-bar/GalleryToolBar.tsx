import { GalleryViewOperators } from './components';
import { useViewConfigurable } from './hook';
import { Others } from './Others';

export const GalleryToolBar: React.FC = () => {
  const { isViewConfigurable } = useViewConfigurable();

  return (
    <div className="flex h-12 items-center border-y px-1 py-2 sm:gap-1 sm:px-2 md:gap-2 md:px-4">
      <div className="flex flex-1 justify-between @container/toolbar">
        <GalleryViewOperators disabled={!isViewConfigurable} />
        <Others />
      </div>
    </div>
  );
};
