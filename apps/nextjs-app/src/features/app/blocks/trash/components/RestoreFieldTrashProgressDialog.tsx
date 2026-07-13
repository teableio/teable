import type {
  IRestoreFieldTrashStreamDoneEvent,
  IRestoreFieldTrashStreamErrorEvent,
  IRestoreFieldTrashStreamProgressEvent,
} from '@teable/openapi';
import {
  SelectionActionProgressDialog,
  type ISelectionActionDialogError,
  type ISelectionActionDialogProgress,
  type ISelectionActionDialogSummary,
  type SelectionActionDialogStatus,
} from '../../view/grid/components/SelectionActionProgressDialog';

const toProgress = (
  progress: IRestoreFieldTrashStreamProgressEvent | null
): ISelectionActionDialogProgress | null =>
  progress
    ? {
        phase: progress.phase === 'restoring' ? 'processing' : 'preparing',
        batchIndex: progress.batchIndex,
        totalCount: progress.totalCount,
        completedCount: progress.updatedCount,
        batchCompletedCount: 0,
      }
    : null;

const toSummary = (
  summary: IRestoreFieldTrashStreamDoneEvent | null
): ISelectionActionDialogSummary | null =>
  summary
    ? {
        totalCount: summary.totalCount,
        completedCount: summary.updatedCount,
        completedRecordIds: [],
      }
    : null;

const toErrors = (errors: IRestoreFieldTrashStreamErrorEvent[]): ISelectionActionDialogError[] =>
  errors.map((error) => ({
    phase: error.phase === 'restoring' ? 'processing' : error.phase,
    batchIndex: error.batchIndex,
    totalCount: error.totalCount,
    completedCount: error.updatedCount,
    recordIds: [],
    message: error.message,
  }));

export const RestoreFieldTrashProgressDialog = ({
  open,
  progress,
  summary,
  errors,
  status,
  onOpenChange,
}: {
  open: boolean;
  progress: IRestoreFieldTrashStreamProgressEvent | null;
  summary: IRestoreFieldTrashStreamDoneEvent | null;
  errors: IRestoreFieldTrashStreamErrorEvent[];
  status: SelectionActionDialogStatus | null;
  onOpenChange?: (open: boolean) => void;
}) => {
  return (
    <SelectionActionProgressDialog
      open={open}
      mode="progress"
      progress={toProgress(progress)}
      summary={toSummary(summary)}
      errors={toErrors(errors)}
      status={status}
      onOpenChange={onOpenChange}
      config={{
        confirmTitleKey: 'table:table.actionTips.restoreFieldStream.confirmTitle',
        confirmDescriptionKey: 'table:table.actionTips.restoreFieldStream.confirmDescription',
        confirmActionKey: 'common:actions.restore',
        runningTitleKey: 'table:table.actionTips.restoreFieldStream.restoring',
        successTitleKey: 'common:actions.restoreSucceed',
        failedTitleKey: 'table:table.actionTips.restoreFieldStream.restoreFailed',
        completedWithIssuesTitleKey:
          'table:table.actionTips.restoreFieldStream.completedWithIssues',
        issuesDescriptionKey: 'table:table.actionTips.restoreFieldStream.descriptionWithIssues',
        runningDescriptionKeys: {
          preparing: 'table:table.actionTips.restoreFieldStream.preparing',
          processing: 'table:table.actionTips.restoreFieldStream.restoringRecords',
        },
        streamKeyPrefix: 'table:table.actionTips.restoreFieldStream',
      }}
    />
  );
};
