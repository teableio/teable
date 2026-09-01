import type {
  IDuplicateSelectionStreamDoneEvent,
  IDuplicateSelectionStreamErrorEvent,
  IDuplicateSelectionStreamProgressEvent,
} from '@teable/openapi';
import { getLocalizationMessage } from '@teable/sdk';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
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
  phase: IDuplicateSelectionStreamProgressEvent['phase']
): 'preparing' | 'processing' => (phase === 'duplicating' ? 'processing' : 'preparing');

const toErrorPhase = (
  phase: IDuplicateSelectionStreamErrorEvent['phase']
): SelectionActionDialogPhase => {
  if (phase === 'duplicating') {
    return 'processing';
  }
  return phase;
};

const toProgress = (
  progress: IDuplicateSelectionStreamProgressEvent | null
): ISelectionActionDialogProgress | null =>
  progress
    ? {
        phase: toPhase(progress.phase),
        batchIndex: progress.batchIndex,
        totalCount: progress.totalCount,
        completedCount: progress.duplicatedCount,
        batchCompletedCount: progress.batchDuplicatedCount,
      }
    : null;

const toSummary = (
  summary: IDuplicateSelectionStreamDoneEvent | null
): ISelectionActionDialogSummary | null =>
  summary
    ? {
        totalCount: summary.totalCount,
        completedCount: summary.duplicatedCount,
        completedRecordIds: summary.data.duplicatedRecordIds,
      }
    : null;

const toErrors = (
  errors: IDuplicateSelectionStreamErrorEvent[],
  t: ILocaleFunction
): ISelectionActionDialogError[] =>
  errors.map((error) => ({
    phase: toErrorPhase(error.phase),
    batchIndex: error.batchIndex,
    totalCount: error.totalCount,
    completedCount: error.duplicatedCount,
    recordIds: error.recordIds,
    message: error.localization
      ? getLocalizationMessage(error.localization, t, 'sdk')
      : error.message,
  }));

export const DuplicateSelectionProgressDialog = ({
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
  progress: IDuplicateSelectionStreamProgressEvent | null;
  summary: IDuplicateSelectionStreamDoneEvent | null;
  errors: IDuplicateSelectionStreamErrorEvent[];
  status: SelectionActionDialogStatus | null;
  confirmRecordCount?: number;
  onConfirm?: () => void;
  onOpenChange?: (open: boolean) => void;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  return (
    <SelectionActionProgressDialog
      open={open}
      mode={mode}
      progress={toProgress(progress)}
      summary={toSummary(summary)}
      errors={toErrors(errors, t as unknown as ILocaleFunction)}
      status={status}
      confirmRecordCount={confirmRecordCount}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      config={{
        confirmTitleKey: 'table:table.actionTips.duplicateRecordsConfirmTitle',
        confirmDescriptionKey: 'table:table.actionTips.duplicateRecordsConfirmDescription',
        confirmActionKey: 'table:table.actionTips.duplicateRecords',
        runningTitleKey: 'table:table.actionTips.duplicating',
        successTitleKey: 'table:table.actionTips.duplicateSuccessful',
        failedTitleKey: 'table:table.actionTips.duplicateFailed',
        completedWithIssuesTitleKey: 'table:table.actionTips.duplicateStream.completedWithIssues',
        issuesDescriptionKey: 'table:table.actionTips.duplicateStream.descriptionWithIssues',
        runningDescriptionKeys: {
          preparing: 'table:table.actionTips.duplicateStream.preparing',
          processing: 'table:table.actionTips.duplicateStream.duplicating',
        },
        streamKeyPrefix: 'table:table.actionTips.duplicateStream',
      }}
    />
  );
};
