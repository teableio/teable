import { useTablePermission } from '@teable/sdk/hooks';
import { KanbanViewOperators } from './components';
import { Others } from './Others';

export const KanbanToolBar: React.FC = () => {
  const permission = useTablePermission();

  return (
    <div className="flex items-center gap-2 border-y px-4 py-2 @container/toolbar">
      <div className="flex flex-1 justify-between overflow-x-auto scrollbar-none">
        <KanbanViewOperators disabled={!permission['view|update']} />
        <Others />
      </div>
    </div>
  );
};
