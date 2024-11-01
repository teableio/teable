import { useTablePermission } from '@teable/sdk/hooks';
import { GalleryViewOperators } from './components';
import { Others } from './Others';

export const GalleryToolBar: React.FC = () => {
  const permission = useTablePermission();

  return (
    <div className="flex items-center gap-2 border-y px-4 py-2 @container/toolbar">
      <div className="flex flex-1 justify-between">
        <GalleryViewOperators disabled={!permission['view|update']} />
        <Others />
      </div>
    </div>
  );
};
