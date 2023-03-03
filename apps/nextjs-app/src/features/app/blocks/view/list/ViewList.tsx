import { useActiveViewId, useViews } from '@teable-group/sdk';
import classnames from 'classnames';

export const ViewList: React.FC = () => {
  const views = useViews();
  const activeViewId = useActiveViewId();
  return (
    <div className="tabs h-14 mx-2">
      {views.map((view, i) => (
        <a
          key={view.id}
          className={classnames('tab', 'tab-bordered', {
            'tab-active': activeViewId ? activeViewId === view.id : i === 0,
          })}
        >
          {view.name}
        </a>
      ))}
    </div>
  );
};
