import { useIsHydrated } from '@teable/sdk/hooks';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Dialog,
  DialogContent,
  Spin,
} from '@teable/ui-lib';
import { XIcon } from 'lucide-react';
import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useWorkFlowPanelStore } from './useWorkFlowPaneStore';

const WorkFlowPanelLazy = lazy(() =>
  import('./WorkFlowPanel').then((module) => ({
    default: module.WorkFlowPanel,
  }))
);

interface AlertCloseDialogProps {
  handleCancel: () => void;
  handleConfirm: () => void;
}
interface AlertCloseDialogRef {
  open: () => void;
}

const AlertCloseWorkflowDialog = forwardRef<AlertCloseDialogRef, AlertCloseDialogProps>(
  (props, ref) => {
    const { handleCancel, handleConfirm } = props;
    const [open, setOpen] = useState(false);
    const { t } = useTranslation(tableConfig.i18nNamespaces);

    useImperativeHandle(
      ref,
      () => {
        return {
          open: () => setOpen(true),
        };
      },
      []
    );
    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common:automation.turnOnTip')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="px-5 py-0.5 text-[13px]" onClick={handleCancel}>
              {t('common:actions.exit')}
            </AlertDialogCancel>
            <AlertDialogAction className="px-5 py-0.5 text-[13px]" onClick={handleConfirm}>
              {t('common:actions.turnOn')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

AlertCloseWorkflowDialog.displayName = 'AlertCloseWorkflowDialog';

interface WorkFlowPanelRef {
  getWorkflow?: () => unknown | undefined;
  checkCanActive?: () => {
    canActive: boolean;
    message: string;
  };
  activeWorkflow?: () => Promise<void>;
}

export const WorkFlowPanelModal = () => {
  const { baseId = '', workflowId = '', closeModal, open } = useWorkFlowPanelStore();
  const isHydrated = useIsHydrated();
  const workflowRef = useRef<WorkFlowPanelRef>(null);
  const alertCloseWorkflowDialogRef = useRef<AlertCloseDialogRef>(null);
  if (!isHydrated || !baseId || !workflowId || !open) {
    return null;
  }

  const handleClose = () => {
    const workflow = workflowRef.current?.getWorkflow?.();
    const isActive = workflow && (workflow as { isActive: boolean }).isActive;
    if (!isActive) {
      const checkRes = workflowRef.current?.checkCanActive?.();
      if (checkRes?.canActive) {
        alertCloseWorkflowDialogRef.current?.open();
        return;
      }
    }
    closeModal();
  };

  return (
    <Dialog open={open}>
      <DialogContent
        closeable={false}
        className="flex max-w-7xl p-2"
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
      >
        <div className="flex-1">
          <Suspense
            fallback={
              <div className="flex size-full items-center justify-center">
                <Spin />
              </div>
            }
          >
            <WorkFlowPanelLazy
              baseId={baseId}
              workflowId={workflowId}
              headLeft={
                <Button variant={'ghost'} size={'xs'} onClick={handleClose}>
                  <XIcon className="size-4" />
                </Button>
              }
              ref={workflowRef}
            />
          </Suspense>
        </div>

        <AlertCloseWorkflowDialog
          ref={alertCloseWorkflowDialogRef}
          handleCancel={() => {
            closeModal();
          }}
          handleConfirm={() => {
            workflowRef.current?.activeWorkflow?.();
            closeModal();
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
