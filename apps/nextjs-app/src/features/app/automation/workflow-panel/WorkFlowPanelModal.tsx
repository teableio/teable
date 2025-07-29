import { useIsHydrated } from '@teable/sdk/hooks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useWorkFlowPanelStore } from './useWorkFlowPaneStore';

const WorkFlowPanelLazy = lazy(() =>
  import('./WorkFlowPanel').then((module) => ({
    default: module.WorkFlowPanel,
  }))
);
export const WorkFlowPanelModal = () => {
  const { baseId = '', workflowId = '', closeModal, open } = useWorkFlowPanelStore();
  const isHydrated = useIsHydrated();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!isHydrated || !baseId || !workflowId || !open) {
    return null;
  }
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      <DialogContent className="w-500 flex h-screen max-h-none max-w-none flex-col p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{t('table:field.default.button.automation')}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 p-6 pt-4">
          <Suspense fallback={<div>Loading workflow panel...</div>}>
            <WorkFlowPanelLazy baseId={baseId} workflowId={workflowId} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
};
