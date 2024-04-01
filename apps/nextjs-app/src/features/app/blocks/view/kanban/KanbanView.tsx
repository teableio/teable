import { ActionTriggerProvider, GroupPointProvider, RecordProvider } from '@teable/sdk/context';
import { useIsHydrated } from '@teable/sdk/hooks';
import { KanbanToolBar } from '../tool-bar/KanbanToolBar';
import { KanbanProvider } from './context';
import { KanbanViewBase } from './KanbanViewBase';

export const KanbanView = () => {
  const isHydrated = useIsHydrated();

  return (
    <ActionTriggerProvider>
      <KanbanToolBar />
      <RecordProvider>
        <GroupPointProvider>
          <KanbanProvider>
            <div className="w-full grow overflow-hidden">{isHydrated && <KanbanViewBase />}</div>
          </KanbanProvider>
        </GroupPointProvider>
      </RecordProvider>
    </ActionTriggerProvider>
  );
};
