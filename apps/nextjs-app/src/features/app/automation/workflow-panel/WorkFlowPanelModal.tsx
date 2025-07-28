import { useIsHydrated } from '@teable/sdk/hooks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { lazy, Suspense } from 'react';
import { useWorkFlowPanelStore } from './useWorkFlowPaneStore';
// import { WorkFlowPanel } from './WorkFlowPanel';

const WorkFlowPanelLazy = lazy(() =>
  import('./WorkFlowPanel').then((module) => ({
    default: module.WorkFlowPanel,
  }))
);
export const WorkFlowPanelModal = () => {
  const { baseId, workflowId, closeModal, open } = useWorkFlowPanelStore();
  const isHydrated = useIsHydrated();

  if (!isHydrated || !baseId || !workflowId || !open) {
    return null;
  }
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      <DialogContent className="w-500 flex h-screen max-h-none max-w-none flex-col p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>Custom Automation</DialogTitle>
        </DialogHeader>
        <div className="flex-1 p-6 pt-4">
          <Suspense fallback={<div>Loading workflow panel...</div>}>
            <WorkFlowPanelLazy baseId={baseId} workflowId={workflowId} />
            {/* <WorkFlowPanel baseId={baseId} workflowId={workflowId} /> */}
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
};
