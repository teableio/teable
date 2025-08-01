import { forwardRef, useImperativeHandle } from 'react';
import { AutomationPage } from '../Pages';

interface WorkFlowPanelRef {
  getWorkflow?: () => unknown | undefined;
  checkCanActive?: () => {
    canActive: boolean;
    message: string;
  };
  activeWorkflow?: () => Promise<void>;
}

interface WorkFlowPanelProps {
  baseId: string;
  workflowId: string;
  headLeft?: React.ReactNode;
}

const WorkFlowPanel = forwardRef<WorkFlowPanelRef, WorkFlowPanelProps>((_props, ref) => {
  useImperativeHandle(
    ref,
    () => {
      return {};
    },
    []
  );

  return <AutomationPage />;
});

WorkFlowPanel.displayName = 'WorkFlowPanel';

export { WorkFlowPanel };
