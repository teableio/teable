import { usePersonalView, useTablePermission } from '@teable/sdk/hooks';
import { CalendarViewOperators } from './components';
import { Others } from './Others';

export const CalendarToolBar: React.FC = () => {
  const permission = useTablePermission();
  const { isPersonalView } = usePersonalView();

  return (
    <div className="flex items-center gap-2 border-y px-4 py-2 @container/toolbar">
      <div className="flex flex-1 justify-between">
        <CalendarViewOperators disabled={!permission['view|update'] && !isPersonalView} />
        <Others />
      </div>
    </div>
  );
};
