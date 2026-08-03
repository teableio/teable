import { KanbanContainer } from './components';
import { useKanban } from './hooks';

export const KanbanViewBase = () => {
  const { stackCollection } = useKanban();

  if (stackCollection == null) {
    return null;
  }

  return (
    <div className="relative size-full overflow-x-auto overflow-y-hidden p-2">
      <KanbanContainer />
    </div>
  );
};
