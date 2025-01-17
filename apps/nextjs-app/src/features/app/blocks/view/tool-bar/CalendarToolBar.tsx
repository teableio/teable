import { CalendarViewOperators } from './components';
import { useViewConfigurable } from './hook';
import { Others } from './Others';

export const CalendarToolBar: React.FC = () => {
  const { isViewConfigurable } = useViewConfigurable();

  return (
    <div className="flex items-center gap-2 border-y px-4 py-2 @container/toolbar">
      <div className="flex flex-1 justify-between">
        <CalendarViewOperators disabled={!isViewConfigurable} />
        <Others />
      </div>
    </div>
  );
};
