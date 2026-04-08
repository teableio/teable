import { AlertCircle, CheckCircle2, ChevronDown } from '@teable/icons';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export type SelectionActionDialogStatus = 'running' | 'success' | 'partial' | 'error';
export type SelectionActionDialogMode = 'confirm' | 'progress';
export type SelectionActionDialogPhase =
  | 'preparing'
  | 'guarding'
  | 'processing'
  | 'publishing'
  | 'finalizing';

export interface ISelectionActionDialogProgress {
  phase: 'preparing' | 'processing';
  batchIndex: number;
  totalCount: number;
  completedCount: number;
  batchCompletedCount: number;
}

export interface ISelectionActionDialogSummary {
  totalCount: number;
  completedCount: number;
  completedRecordIds: string[];
}

export interface ISelectionActionDialogError {
  phase: SelectionActionDialogPhase;
  batchIndex: number;
  totalCount: number;
  completedCount: number;
  recordIds: string[];
  message: string;
}

type SelectionActionDialogTranslation = (
  key: string,
  options?: Record<string, number | string>
) => string;

type SelectionActionDialogConfig = {
  confirmTitleKey: string;
  confirmDescriptionKey: string;
  confirmActionKey: string;
  runningTitleKey: string;
  successTitleKey: string;
  failedTitleKey: string;
  completedWithIssuesTitleKey: string;
  issuesDescriptionKey: string;
  runningDescriptionKeys: {
    preparing: string;
    processing: string;
  };
  streamKeyPrefix: string;
  phaseKeyOverrides?: Partial<Record<SelectionActionDialogPhase, string>>;
  confirmButtonVariant?: 'default' | 'destructive';
};

type InterpolatedProgressAnchor = {
  completedCount: number;
  anchorAt: number;
  nextBatchCount: number;
  predictedBatchDurationMs: number;
};

const PROGRESS_INTERPOLATION_TICK_MS = 100;
const MIN_PREDICTED_BATCH_DURATION_MS = 1000;
const MAX_PREDICTED_BATCH_DURATION_MS = 30000;
const ELAPSED_TIME_HIGH_PRECISION_MS = 10000;
const ELAPSED_TIME_MEDIUM_PRECISION_MS = 60000;
const ELAPSED_TIME_LOW_PRECISION_MS = 10 * 60 * 1000;

const clampPredictedBatchDuration = (durationMs: number) =>
  Math.min(MAX_PREDICTED_BATCH_DURATION_MS, Math.max(MIN_PREDICTED_BATCH_DURATION_MS, durationMs));

const getElapsedTimeTickMs = (elapsedMs: number) => {
  if (elapsedMs < ELAPSED_TIME_HIGH_PRECISION_MS) {
    return 50;
  }

  if (elapsedMs < ELAPSED_TIME_MEDIUM_PRECISION_MS) {
    return 200;
  }

  if (elapsedMs < ELAPSED_TIME_LOW_PRECISION_MS) {
    return 1000;
  }

  return 5000;
};

const formatElapsedTime = (elapsedMs: number) => {
  if (elapsedMs < ELAPSED_TIME_HIGH_PRECISION_MS) {
    return `${(elapsedMs / 1000).toFixed(2)}s`;
  }

  if (elapsedMs < ELAPSED_TIME_MEDIUM_PRECISION_MS) {
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const useInterpolatedSelectionActionProgress = ({
  open,
  mode,
  progress,
  resolvedStatus,
  isPreparing,
  exactCompletedCount,
}: {
  open: boolean;
  mode: SelectionActionDialogMode;
  progress: ISelectionActionDialogProgress | null;
  resolvedStatus: SelectionActionDialogStatus;
  isPreparing: boolean;
  exactCompletedCount: number;
}) => {
  const [displayedCompletedCount, setDisplayedCompletedCount] = useState(exactCompletedCount);
  const [anchor, setAnchor] = useState<InterpolatedProgressAnchor | null>(null);
  const processingStartedAtRef = useRef<number | null>(null);
  const lastAnchorRef = useRef<InterpolatedProgressAnchor | null>(null);
  const lastProgressSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || mode !== 'progress' || resolvedStatus !== 'running') {
      processingStartedAtRef.current = null;
      lastAnchorRef.current = null;
      lastProgressSignatureRef.current = null;
      setAnchor(null);
      setDisplayedCompletedCount(exactCompletedCount);
      return;
    }

    if (!progress) {
      processingStartedAtRef.current = null;
      lastAnchorRef.current = null;
      lastProgressSignatureRef.current = null;
      setAnchor(null);
      setDisplayedCompletedCount(exactCompletedCount);
      return;
    }

    if (isPreparing) {
      if (processingStartedAtRef.current == null) {
        processingStartedAtRef.current = Date.now();
      }
      lastAnchorRef.current = null;
      lastProgressSignatureRef.current = null;
      setAnchor(null);
      setDisplayedCompletedCount(exactCompletedCount);
      return;
    }

    if (processingStartedAtRef.current == null) {
      processingStartedAtRef.current = Date.now();
    }

    const signature = [
      progress.phase,
      progress.batchIndex,
      progress.completedCount,
      progress.batchCompletedCount,
      progress.totalCount,
    ].join(':');

    if (lastProgressSignatureRef.current === signature) {
      return;
    }

    lastProgressSignatureRef.current = signature;
    setDisplayedCompletedCount(progress.completedCount);

    if (progress.completedCount <= 0) {
      return;
    }

    const now = Date.now();
    const previousAnchor = lastAnchorRef.current;
    const previousCompletedCount = previousAnchor?.completedCount ?? 0;
    const observedBatchCount = Math.max(
      progress.batchCompletedCount || progress.completedCount - previousCompletedCount,
      1
    );
    const elapsedSincePreviousAnchor =
      previousAnchor?.anchorAt != null
        ? now - previousAnchor.anchorAt
        : now - (processingStartedAtRef.current ?? now);
    const nextBatchCount = Math.max(
      0,
      Math.min(progress.totalCount - progress.completedCount, observedBatchCount)
    );
    const nextAnchor: InterpolatedProgressAnchor = {
      completedCount: progress.completedCount,
      anchorAt: now,
      nextBatchCount,
      predictedBatchDurationMs: clampPredictedBatchDuration(elapsedSincePreviousAnchor),
    };

    lastAnchorRef.current = nextAnchor;
    setAnchor(nextAnchor);
  }, [exactCompletedCount, isPreparing, mode, open, progress, resolvedStatus]);

  useEffect(() => {
    if (
      !open ||
      mode !== 'progress' ||
      resolvedStatus !== 'running' ||
      isPreparing ||
      !anchor ||
      anchor.nextBatchCount <= 0
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      const elapsed = Date.now() - anchor.anchorAt;
      const predictedAdvance = Math.floor(
        (elapsed / anchor.predictedBatchDurationMs) * anchor.nextBatchCount
      );
      const nextDisplayedCompletedCount = Math.min(
        anchor.completedCount + anchor.nextBatchCount - 1,
        anchor.completedCount + predictedAdvance
      );

      setDisplayedCompletedCount((previousCount) =>
        Math.max(previousCount, anchor.completedCount, nextDisplayedCompletedCount)
      );
    }, PROGRESS_INTERPOLATION_TICK_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [anchor, isPreparing, mode, open, resolvedStatus]);

  return useMemo(
    () => Math.max(displayedCompletedCount, exactCompletedCount),
    [displayedCompletedCount, exactCompletedCount]
  );
};

const useAdaptiveElapsedTimeLabel = ({
  open,
  mode,
  resolvedStatus,
}: {
  open: boolean;
  mode: SelectionActionDialogMode;
  resolvedStatus: SelectionActionDialogStatus;
}) => {
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!open || mode !== 'progress') {
      setStartAt(null);
      setNow(null);
      return;
    }

    if (resolvedStatus === 'running') {
      const startedAt = startAt ?? Date.now();
      if (startAt == null) {
        setStartAt(startedAt);
      }
      setNow(Date.now());
      return;
    }

    if (startAt != null && now == null) {
      setNow(Date.now());
    }
  }, [mode, now, open, resolvedStatus, startAt]);

  useEffect(() => {
    if (!open || mode !== 'progress' || resolvedStatus !== 'running' || startAt == null) {
      return;
    }

    const tick = () => {
      const currentNow = Date.now();
      setNow(currentNow);
      const timer = window.setTimeout(tick, getElapsedTimeTickMs(currentNow - startAt));
      timerRef.current = timer;
    };

    const timerRef = { current: 0 as number | undefined };
    timerRef.current = window.setTimeout(tick, getElapsedTimeTickMs(Date.now() - startAt));

    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [mode, open, resolvedStatus, startAt]);

  return useMemo(() => {
    if (startAt == null) {
      return null;
    }

    const effectiveNow = now ?? Date.now();
    return formatElapsedTime(Math.max(0, effectiveNow - startAt));
  }, [now, startAt]);
};

const getPhaseLabel = (
  t: SelectionActionDialogTranslation,
  config: SelectionActionDialogConfig,
  phase: SelectionActionDialogPhase
) => {
  const phaseKey = config.phaseKeyOverrides?.[phase] ?? phase;
  return t(`${config.streamKeyPrefix}.phaseLabel.${phaseKey}`);
};

const getDialogTitle = (
  t: SelectionActionDialogTranslation,
  config: SelectionActionDialogConfig,
  status: SelectionActionDialogStatus
) => {
  if (status === 'partial') {
    return t(config.completedWithIssuesTitleKey);
  }

  if (status === 'success') {
    return t(config.successTitleKey);
  }

  if (status === 'error') {
    return t(config.failedTitleKey);
  }

  return t(config.runningTitleKey);
};

const getDialogDescription = (
  t: SelectionActionDialogTranslation,
  config: SelectionActionDialogConfig,
  status: SelectionActionDialogStatus,
  latestError: string | undefined,
  progressPhase?: 'preparing' | 'processing'
) => {
  if (status === 'partial') {
    return t(config.issuesDescriptionKey);
  }

  if (status === 'error') {
    return latestError ?? t(config.failedTitleKey);
  }

  if (status === 'success') {
    return null;
  }

  if (progressPhase === 'preparing') {
    return t(config.runningDescriptionKeys.preparing);
  }

  return t(config.runningDescriptionKeys.processing);
};

const resolveDialogStatus = (
  status: SelectionActionDialogStatus | null,
  summary: ISelectionActionDialogSummary | null,
  hasErrors: boolean
): SelectionActionDialogStatus =>
  status ?? (summary ? (hasErrors ? 'partial' : 'success') : hasErrors ? 'error' : 'running');

const getDialogProgressState = ({
  mode,
  progress,
  summary,
  errors,
  status,
  confirmRecordCount,
  t,
  config,
}: {
  mode: SelectionActionDialogMode;
  progress: ISelectionActionDialogProgress | null;
  summary: ISelectionActionDialogSummary | null;
  errors: ISelectionActionDialogError[];
  status: SelectionActionDialogStatus | null;
  confirmRecordCount?: number;
  t: SelectionActionDialogTranslation;
  config: SelectionActionDialogConfig;
}) => {
  const totalCount = summary?.totalCount ?? progress?.totalCount ?? confirmRecordCount ?? 0;
  const completedCount = summary?.completedCount ?? progress?.completedCount ?? 0;
  const percent =
    totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0;
  const hasErrors = errors.length > 0;
  const resolvedStatus = resolveDialogStatus(status, summary, hasErrors);
  const progressPhase = progress?.phase ?? 'preparing';
  const isPreparing = resolvedStatus === 'running' && progressPhase === 'preparing';
  const latestError = errors.at(-1)?.message;

  return {
    totalCount,
    completedCount,
    percent,
    resolvedStatus,
    progressPhase,
    isPreparing,
    canDismiss: mode === 'confirm' || resolvedStatus !== 'running',
    title:
      mode === 'confirm' ? t(config.confirmTitleKey) : getDialogTitle(t, config, resolvedStatus),
    description:
      mode === 'confirm'
        ? t(config.confirmDescriptionKey, {
            recordCount: confirmRecordCount ?? 0,
          })
        : getDialogDescription(t, config, resolvedStatus, latestError, progress?.phase),
    displayPercent: isPreparing
      ? 0
      : resolvedStatus === 'running'
        ? Math.max(percent, totalCount > 0 ? 2 : 0)
        : percent,
    statusSummaryLabel: getDialogStatusSummaryLabel(
      t,
      config,
      resolvedStatus,
      progressPhase,
      errors.length
    ),
  };
};

const getDialogStatusSummaryLabel = (
  t: SelectionActionDialogTranslation,
  config: SelectionActionDialogConfig,
  status: SelectionActionDialogStatus,
  progressPhase: SelectionActionDialogPhase,
  errorCount: number
) => {
  if (status === 'running') {
    return getPhaseLabel(t, config, progressPhase);
  }

  if (status === 'partial') {
    return t(`${config.streamKeyPrefix}.issuesBadge`, { count: errorCount });
  }

  if (status === 'error') {
    return t(config.failedTitleKey);
  }

  return t(config.successTitleKey);
};

const getProgressIndicatorClassName = (status: SelectionActionDialogStatus) => {
  if (status === 'partial' || status === 'error') {
    return 'bg-destructive transition-[transform] duration-500 ease-out';
  }

  return 'bg-foreground transition-[transform] duration-500 ease-out';
};

const getStatusAccentClassName = (status: SelectionActionDialogStatus) => {
  if (status === 'success') {
    return 'text-emerald-600 dark:text-emerald-500';
  }

  if (status === 'partial') {
    return 'text-amber-500 dark:text-amber-400';
  }

  if (status === 'error') {
    return 'text-destructive';
  }

  return 'text-muted-foreground';
};

const SelectionActionStatusIcon = ({ status }: { status: SelectionActionDialogStatus }) => {
  if (status === 'success') {
    return <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-500" />;
  }

  if (status === 'partial') {
    return <AlertCircle className="size-5 shrink-0 text-amber-500 dark:text-amber-400" />;
  }

  if (status === 'error') {
    return <AlertCircle className="size-5 shrink-0 text-destructive" />;
  }

  return <Spin className="size-4 shrink-0 text-muted-foreground" />;
};

const SelectionActionChunkErrorDetails = ({
  config,
  errors,
}: {
  config: SelectionActionDialogConfig;
  errors: ISelectionActionDialogError[];
}) => {
  const { t: translate } = useTranslation(tableConfig.i18nNamespaces);
  const t = translate as unknown as SelectionActionDialogTranslation;
  if (!errors.length) {
    return null;
  }

  return (
    <Collapsible className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 text-left text-sm text-foreground">
        <div>
          <div className="font-medium">{t(`${config.streamKeyPrefix}.chunkFailureTitle`)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t(`${config.streamKeyPrefix}.chunkFailureSummary`, {
              count: errors.length,
            })}
          </div>
        </div>
        <ChevronDown className="size-4 shrink-0 text-destructive data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-2">
        {errors.map((error, index) => (
          <div
            key={`${error.batchIndex}-${index}-${error.message}`}
            className="rounded-md border border-border bg-background p-3"
          >
            <div className="flex items-center justify-between gap-3 text-xs text-destructive">
              <span>
                {error.batchIndex >= 0
                  ? t(`${config.streamKeyPrefix}.chunkLabel`, {
                      index: error.batchIndex + 1,
                    })
                  : getPhaseLabel(t, config, error.phase)}
              </span>
              <span>
                {t(`${config.streamKeyPrefix}.rowsLabel`, {
                  count: error.recordIds.length,
                })}
              </span>
            </div>
            <div className="mt-2 text-sm text-foreground">{error.message}</div>
            {error.recordIds.length ? (
              <div className="mt-2 line-clamp-2 font-mono text-[11px] text-muted-foreground">
                {error.recordIds.join(', ')}
              </div>
            ) : null}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

const SelectionActionConfirmContent = ({
  onConfirm,
  onOpenChange,
  config,
  t,
}: {
  onConfirm?: () => void;
  onOpenChange?: (open: boolean) => void;
  config: SelectionActionDialogConfig;
  t: SelectionActionDialogTranslation;
}) => {
  return (
    <DialogFooter className="border-t px-5 py-4 sm:justify-end">
      <Button size="sm" variant="secondary" onClick={() => onOpenChange?.(false)}>
        {t('common:actions.cancel')}
      </Button>
      <Button
        size="sm"
        variant={config.confirmButtonVariant ?? 'default'}
        onClick={() => onConfirm?.()}
      >
        {t(config.confirmActionKey)}
      </Button>
    </DialogFooter>
  );
};

const SelectionActionProgressContent = ({
  config,
  t,
  percent,
  displayPercent,
  isPreparing,
  formattedCompletedCount,
  formattedTotalCount,
  statusSummaryLabel,
  resolvedStatus,
  errors,
  canDismiss,
  onOpenChange,
  elapsedTimeLabel,
}: {
  config: SelectionActionDialogConfig;
  t: SelectionActionDialogTranslation;
  percent: number;
  displayPercent: number;
  isPreparing: boolean;
  formattedCompletedCount: string;
  formattedTotalCount: string;
  statusSummaryLabel: string;
  resolvedStatus: SelectionActionDialogStatus;
  errors: ISelectionActionDialogError[];
  canDismiss: boolean;
  onOpenChange?: (open: boolean) => void;
  elapsedTimeLabel: string | null;
}) => {
  return (
    <>
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className={`text-sm font-medium ${getStatusAccentClassName(resolvedStatus)}`}>
            {statusSummaryLabel}
          </div>
          {!isPreparing ? (
            <div className="text-sm font-medium tabular-nums text-foreground">{percent}%</div>
          ) : null}
        </div>

        {isPreparing ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="size-full bg-foreground/10 motion-safe:animate-pulse" />
          </div>
        ) : (
          <Progress
            value={displayPercent}
            className="mt-3 h-2 bg-muted"
            indicatorClassName={getProgressIndicatorClassName(resolvedStatus)}
          />
        )}

        {!isPreparing ? (
          <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
            <div className="tabular-nums">
              <span className="font-medium text-foreground">{formattedCompletedCount}</span>
              <span> / {formattedTotalCount}</span>
            </div>
            {elapsedTimeLabel ? <div className="tabular-nums">{elapsedTimeLabel}</div> : null}
          </div>
        ) : null}
      </div>

      <SelectionActionChunkErrorDetails config={config} errors={errors} />

      {canDismiss ? (
        <DialogFooter className="border-t px-5 py-4 sm:justify-end">
          <Button size="sm" variant="secondary" onClick={() => onOpenChange?.(false)}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
};

export const SelectionActionProgressDialog = ({
  open,
  mode,
  progress,
  summary,
  errors,
  status,
  confirmRecordCount,
  onConfirm,
  onOpenChange,
  config,
}: {
  open: boolean;
  mode: SelectionActionDialogMode;
  progress: ISelectionActionDialogProgress | null;
  summary: ISelectionActionDialogSummary | null;
  errors: ISelectionActionDialogError[];
  status: SelectionActionDialogStatus | null;
  confirmRecordCount?: number;
  onConfirm?: () => void;
  onOpenChange?: (open: boolean) => void;
  config: SelectionActionDialogConfig;
}) => {
  const { t: translate } = useTranslation(tableConfig.i18nNamespaces);
  const t = translate as unknown as SelectionActionDialogTranslation;
  const {
    totalCount,
    completedCount,
    resolvedStatus,
    isPreparing,
    canDismiss,
    title,
    description,
    statusSummaryLabel,
  } = getDialogProgressState({
    mode,
    progress,
    summary,
    errors,
    status,
    confirmRecordCount,
    t,
    config,
  });
  const interpolatedCompletedCount = useInterpolatedSelectionActionProgress({
    open,
    mode,
    progress,
    resolvedStatus,
    isPreparing,
    exactCompletedCount: completedCount,
  });
  const displayedCompletedCount =
    mode === 'progress' && resolvedStatus === 'running' && !isPreparing
      ? interpolatedCompletedCount
      : completedCount;
  const percent =
    totalCount > 0 ? Math.min(100, Math.round((displayedCompletedCount / totalCount) * 100)) : 0;
  const displayPercent =
    mode === 'progress' && resolvedStatus === 'running' && isPreparing
      ? 0
      : resolvedStatus === 'running'
        ? Math.max(percent, totalCount > 0 ? 2 : 0)
        : percent;
  const elapsedTimeLabel = useAdaptiveElapsedTimeLabel({
    open,
    mode,
    resolvedStatus,
  });
  const handleOpenChange = (nextOpen: boolean) => {
    if (!canDismiss) {
      return;
    }

    onOpenChange?.(nextOpen);
  };
  const preventDialogDismiss = (event: { preventDefault: () => void }) => {
    if (!canDismiss) {
      event.preventDefault();
    }
  };
  const formattedCompletedCount = displayedCompletedCount.toLocaleString();
  const formattedTotalCount = totalCount.toLocaleString();
  const contentKey = `${mode}-${mode === 'confirm' ? 'confirm' : resolvedStatus}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeable={canDismiss}
        className="gap-0 overflow-hidden p-0 sm:max-w-[480px]"
        onEscapeKeyDown={preventDialogDismiss}
        onInteractOutside={preventDialogDismiss}
      >
        <DialogHeader
          className={
            mode === 'confirm'
              ? 'space-y-2 p-5 pr-12 text-left'
              : 'space-y-2 border-b px-5 py-4 pr-12 text-left'
          }
        >
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold leading-7 text-foreground">
            {mode === 'progress' ? <SelectionActionStatusIcon status={resolvedStatus} /> : null}
            <span>{title}</span>
          </DialogTitle>
          {description ? (
            <DialogDescription className="max-w-md text-sm leading-6 text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {mode === 'confirm' ? (
          <SelectionActionConfirmContent
            onConfirm={onConfirm}
            onOpenChange={onOpenChange}
            config={config}
            t={t}
          />
        ) : (
          <div
            key={contentKey}
            className="space-y-4 px-5 py-4 motion-safe:duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
          >
            <SelectionActionProgressContent
              config={config}
              t={t}
              percent={percent}
              displayPercent={displayPercent}
              isPreparing={isPreparing}
              formattedCompletedCount={formattedCompletedCount}
              formattedTotalCount={formattedTotalCount}
              statusSummaryLabel={statusSummaryLabel}
              resolvedStatus={resolvedStatus}
              errors={errors}
              canDismiss={canDismiss}
              onOpenChange={onOpenChange}
              elapsedTimeLabel={elapsedTimeLabel}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
