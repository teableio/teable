import type {
  IClearSelectionStreamDoneEvent,
  IClearSelectionStreamErrorEvent,
  IClearSelectionStreamProgressEvent,
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

const toPhase = (phase: IClearSelectionStreamProgressEvent['phase']): 'preparing' | 'processing' =>
  phase === 'clearing' ? 'processing' : 'preparing';

const toErrorPhase = (
  phase: IClearSelectionStreamErrorEvent['phase']
): SelectionActionDialogPhase => {
  if (phase === 'clearing') {
    return 'processing';
  }
  return phase;
};

const toProgress = (
  progress: IClearSelectionStreamProgressEvent | null
): ISelectionActionDialogProgress | null =>
  progress
    ? {
        phase: toPhase(progress.phase),
        batchIndex: progress.batchIndex,
        totalCount: progress.totalCount,
        completedCount: progress.processedCount,
        batchCompletedCount: progress.batchProcessedCount,
      }
    : null;

const toSummary = (
  summary: IClearSelectionStreamDoneEvent | null
): ISelectionActionDialogSummary | null =>
  summary
    ? {
        totalCount: summary.totalCount,
        completedCount: summary.processedCount,
        completedRecordIds: summary.data.clearedRecordIds,
      }
    : null;

const toErrors = (errors: IClearSelectionStreamErrorEvent[]): ISelectionActionDialogError[] =>
  errors.map((error) => ({
    phase: toErrorPhase(error.phase),
    batchIndex: error.batchIndex,
    totalCount: error.totalCount,
    completedCount: error.processedCount,
    recordIds: error.recordIds,
    message: error.message,
  }));

export const ClearSelectionProgressDialog = ({
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
  progress: IClearSelectionStreamProgressEvent | null;
  summary: IClearSelectionStreamDoneEvent | null;
  errors: IClearSelectionStreamErrorEvent[];
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
        confirmTitleKey: 'table:table.actionTips.clearConfirmTitle',
        confirmDescriptionKey: 'table:table.actionTips.clearStream.confirmDescription',
        confirmActionKey: 'table:table.actionTips.clear',
        confirmButtonVariant: 'destructive',
        runningTitleKey: 'table:table.actionTips.clearing',
        successTitleKey: 'table:table.actionTips.clearSuccessful',
        failedTitleKey: 'table:table.actionTips.clearFailed',
        completedWithIssuesTitleKey: 'table:table.actionTips.clearStream.completedWithIssues',
        issuesDescriptionKey: 'table:table.actionTips.clearStream.descriptionWithIssues',
        runningDescriptionKeys: {
          preparing: 'table:table.actionTips.clearStream.preparing',
          processing: 'table:table.actionTips.clearStream.clearing',
        },
        streamKeyPrefix: 'table:table.actionTips.clearStream',
      }}
    />
  );
};
