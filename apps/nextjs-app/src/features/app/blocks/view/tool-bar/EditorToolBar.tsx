import { EditorViewOperators } from './components/EditorViewOperators';
import { useViewConfigurable } from './hook';
import { Others } from './Others';

export const EditorToolBar: React.FC = () => {
  const { isViewConfigurable } = useViewConfigurable();

  return (
    <div className="flex h-12 items-center gap-2 border-y px-4 py-2 @container/toolbar">
      <div className="flex flex-1 justify-between">
        <EditorViewOperators disabled={!isViewConfigurable} />
        <Others />
      </div>
    </div>
  );
};
