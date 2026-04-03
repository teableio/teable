import type {
  IPasteSelectionStreamDoneEvent,
  IPasteSelectionStreamErrorEvent,
  IPasteSelectionStreamProgressEvent,
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

const toPhase = (phase: IPasteSelectionStreamProgressEvent['phase']): 'preparing' | 'processing' =>
  phase === 'pasting' ? 'processing' : 'preparing';

const toErrorPhase = (
  phase: IPasteSelectionStreamErrorEvent['phase']
): SelectionActionDialogPhase => {
  if (phase === 'pasting') {
    return 'processing';
  }
  return phase;
};

const toProgress = (
  progress: IPasteSelectionStreamProgressEvent | null
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
  summary: IPasteSelectionStreamDoneEvent | null
): ISelectionActionDialogSummary | null =>
  summary
    ? {
        totalCount: summary.totalCount,
        completedCount: summary.processedCount,
        completedRecordIds: summary.data.createdRecordIds,
      }
    : null;

const toErrors = (errors: IPasteSelectionStreamErrorEvent[]): ISelectionActionDialogError[] =>
  errors.map((error) => ({
    phase: toErrorPhase(error.phase),
    batchIndex: error.batchIndex,
    totalCount: error.totalCount,
    completedCount: error.processedCount,
    recordIds: error.recordIds,
    message: error.message,
  }));

export const PasteSelectionProgressDialog = ({
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
  progress: IPasteSelectionStreamProgressEvent | null;
  summary: IPasteSelectionStreamDoneEvent | null;
  errors: IPasteSelectionStreamErrorEvent[];
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
        confirmTitleKey: 'table:table.actionTips.pasteConfirmTitle',
        confirmDescriptionKey: 'table:table.actionTips.pasteConfirmDescription',
        confirmActionKey: 'table:table.actionTips.paste',
        runningTitleKey: 'table:table.actionTips.pasting',
        successTitleKey: 'table:table.actionTips.pasteSuccessful',
        failedTitleKey: 'table:table.actionTips.pasteFailed',
        completedWithIssuesTitleKey: 'table:table.actionTips.pasteStream.completedWithIssues',
        issuesDescriptionKey: 'table:table.actionTips.pasteStream.descriptionWithIssues',
        runningDescriptionKeys: {
          preparing: 'table:table.actionTips.pasteStream.preparing',
          processing: 'table:table.actionTips.pasteStream.pasting',
        },
        streamKeyPrefix: 'table:table.actionTips.pasteStream',
      }}
    />
  );
};
