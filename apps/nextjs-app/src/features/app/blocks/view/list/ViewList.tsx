import { useViewId, useViews } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import { useAddView } from './useAddView';
import { ViewListItem } from './ViewListItem';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useViewId();
  const addView = useAddView();
  return (
    <div className="tabs mx-2">
      {views.map((view) => (
        <ViewListItem key={view.id} view={view} isActive={view.id === activeViewId} />
      ))}
      <a className="tab">
        <button className="btn btn-xs btn-ghost" onClick={addView}>
          <AddBoldIcon />
          <span className="ml-1">View</span>
        </button>
      </a>
    </div>
  );
};
