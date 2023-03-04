import { useActiveViewId, useViews } from '@teable-group/sdk';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/add-bold.svg';
import classnames from 'classnames';
import { useAddView } from './useAddView';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useActiveViewId();
  const addView = useAddView();
  return (
    <div className="tabs h-14 mx-2">
      {views.map((view, i) => (
        <a
          key={view.id}
          className={classnames(
            'tab tab-bordered text-ellipsis overflow-hidden whitespace-nowrap inline-block',
            {
              'tab-active': activeViewId ? activeViewId === view.id : i === 0,
            }
          )}
          style={{ maxWidth: 200 }}
          title={view.name}
        >
          {view.name}
        </a>
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
