import type {
  IDeleteSelectionStreamDoneEvent,
  IDeleteSelectionStreamErrorEvent,
  IDeleteSelectionStreamProgressEvent,
} from '@teable/openapi';
import {
  SelectionActionProgressDialog,
  type ISelectionActionDialogError,
  type ISelectionActionDialogProgress,
  type ISelectionActionDialogSummary,
  type SelectionActionDialogMode,
  type SelectionActionDialogPhase,
  type SelectionActionDialogStatus,
} from './SelectionActionProgressDialog';

const toPhase = (
  phase: IDeleteSelectionStreamProgressEvent['phase']
): 'preparing' | 'processing' => (phase === 'deleting' ? 'processing' : 'preparing');

const toErrorPhase = (
  phase: IDeleteSelectionStreamErrorEvent['phase']
): SelectionActionDialogPhase => {
  if (phase === 'deleting') {
    return 'processing';
  }
  return phase;
};

const toProgress = (
  progress: IDeleteSelectionStreamProgressEvent | null
): ISelectionActionDialogProgress | null =>
  progress
    ? {
        phase: toPhase(progress.phase),
        batchIndex: progress.batchIndex,
        totalCount: progress.totalCount,
        completedCount: progress.deletedCount,
        batchCompletedCount: progress.batchDeletedCount,
      }
    : null;

const toSummary = (
  summary: IDeleteSelectionStreamDoneEvent | null
): ISelectionActionDialogSummary | null =>
  summary
    ? {
        totalCount: summary.totalCount,
        completedCount: summary.deletedCount,
        completedRecordIds: summary.data.deletedRecordIds,
      }
    : null;

const toErrors = (errors: IDeleteSelectionStreamErrorEvent[]): ISelectionActionDialogError[] =>
  errors.map((error) => ({
    phase: toErrorPhase(error.phase),
    batchIndex: error.batchIndex,
    totalCount: error.totalCount,
    completedCount: error.deletedCount,
    recordIds: error.recordIds,
    message: error.message,
  }));

export const DeleteSelectionProgressDialog = ({
  open,
  mode,
  progress,
  summary,
  errors,
  status,
  confirmRecordCount,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  mode: SelectionActionDialogMode;
  progress: IDeleteSelectionStreamProgressEvent | null;
  summary: IDeleteSelectionStreamDoneEvent | null;
  errors: IDeleteSelectionStreamErrorEvent[];
  status: SelectionActionDialogStatus | null;
  confirmRecordCount?: number;
  onConfirm?: () => void;
  onOpenChange?: (open: boolean) => void;
}) => {
  return (
    <SelectionActionProgressDialog
      open={open}
      mode={mode}
      progress={toProgress(progress)}
      summary={toSummary(summary)}
      errors={toErrors(errors)}
      status={status}
      confirmRecordCount={confirmRecordCount}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      config={{
        confirmTitleKey: 'table:table.actionTips.deleteRecordConfirmTitle',
        confirmDescriptionKey: 'table:table.actionTips.deleteRecordConfirmDescription',
        confirmActionKey: 'table:table.actionTips.deleteRecord',
        runningTitleKey: 'table:table.actionTips.deleting',
        successTitleKey: 'table:table.actionTips.deleteSuccessful',
        failedTitleKey: 'table:table.actionTips.deleteFailed',
        completedWithIssuesTitleKey: 'table:table.actionTips.deleteStream.completedWithIssues',
        issuesDescriptionKey: 'table:table.actionTips.deleteStream.descriptionWithIssues',
        runningDescriptionKeys: {
          preparing: 'table:table.actionTips.deleteStream.preparing',
          processing: 'table:table.actionTips.deleteStream.deleting',
        },
        streamKeyPrefix: 'table:table.actionTips.deleteStream',
        phaseKeyOverrides: {
          processing: 'deleting',
        },
        confirmButtonVariant: 'destructive',
      }}
    />
  );
};
