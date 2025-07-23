import { AutomationPage } from '../Pages';

interface WorkFlowPanelProps {
  baseId: string;
  workflowId: string;
}

const WorkFlowPanel = (_props: WorkFlowPanelProps) => {
  return <AutomationPage />;
};

export { WorkFlowPanel };
