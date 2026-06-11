import { AlertCircle, CheckCircle2 } from '@teable/icons';
import { Spin } from '@teable/ui-lib/index';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';

export interface ILogEntry {
  message: string;
  type: 'info' | 'warning' | 'error' | 'done';
  timestamp: number;
}

export interface ITableImportProgress {
  tableId: string;
  tableName: string;
  processedRows: number;
  totalRows?: number;
  batchProcessedRows?: number;
  currentBatch?: number;
  status: 'running' | 'done';
  unit?: 'rows' | 'tables';
}

interface IImportLogPanelProps {
  logs: ILogEntry[];
  tableProgresses: ITableImportProgress[];
  isImporting: boolean;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const hasProgressTotal = (progress: ITableImportProgress) =>
  Boolean(progress.totalRows && progress.totalRows > 0);

const getProgressPercent = (progress: ITableImportProgress) => {
  if (!hasProgressTotal(progress)) {
    return undefined;
  }

  const percent = (progress.processedRows / progress.totalRows!) * 100;
  return Math.max(progress.processedRows > 0 ? 3 : 0, Math.min(100, percent));
};

const getProgressCountText = (progress: ITableImportProgress, t: TranslateFn) => {
  if (progress.unit === 'tables') {
    return t(
      progress.status === 'done'
        ? 'space:import.phase.tableStructureTablesDone'
        : 'space:import.phase.tableStructureTablesProgress',
      { count: progress.processedRows, total: progress.totalRows }
    );
  }

  if (hasProgressTotal(progress)) {
    return t(
      progress.status === 'done'
        ? 'space:import.phase.tableDataRowsTotalDone'
        : 'space:import.phase.tableDataRowsTotalProgress',
      { count: progress.processedRows, total: progress.totalRows }
    );
  }

  return t(
    progress.status === 'done'
      ? 'space:import.phase.tableDataRowsDone'
      : 'space:import.phase.tableDataRowsProgress',
    { count: progress.processedRows }
  );
};

const getProgressBatchText = (progress: ITableImportProgress, t: TranslateFn) => {
  if (progress.unit === 'tables') {
    return '';
  }

  const batchText = progress.currentBatch
    ? ` · ${t('space:import.phase.tableDataBatch', { batch: progress.currentBatch })}`
    : '';
  const batchRowsText =
    progress.status === 'running' && progress.batchProcessedRows
      ? ` · ${t('space:import.phase.tableDataBatchRows', {
          count: progress.batchProcessedRows,
        })}`
      : '';

  return `${batchText}${batchRowsText}`;
};

const TableProgressCard = ({ progress, t }: { progress: ITableImportProgress; t: TranslateFn }) => {
  const hasTotal = hasProgressTotal(progress);
  const progressPercent = getProgressPercent(progress);

  return (
    <div className="rounded border bg-muted/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium">{progress.tableName}</span>
        <span className="shrink-0 text-muted-foreground">
          {getProgressCountText(progress, t)}
          {getProgressBatchText(progress, t)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded bg-muted">
        <div
          className={cn('h-full bg-primary transition-all', {
            'w-full': progress.status === 'done' && !hasTotal,
            'w-2/3 animate-pulse': progress.status === 'running' && !hasTotal,
          })}
          style={hasTotal ? { width: `${progressPercent}%` } : undefined}
        />
      </div>
    </div>
  );
};

export const ImportLogPanel = ({ logs, tableProgresses, isImporting }: IImportLogPanelProps) => {
  const logEndRef = React.useRef<HTMLDivElement>(null);
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const tAny = t as TranslateFn;
  const normalLogs = logs.filter((log) => log.type !== 'error');
  const errorLogs = logs.filter((log) => log.type === 'error');

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, tableProgresses]);

  if (logs.length === 0 && tableProgresses.length === 0) return null;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-md border bg-background">
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-6">
        {normalLogs.map((log, i) => (
          <div key={log.timestamp + i} className="flex items-start gap-2">
            {log.type === 'warning' ? (
              <AlertCircle className="mt-1 size-3.5 shrink-0 text-amber-500" />
            ) : log.type === 'done' ? (
              <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-green-500" />
            ) : i === normalLogs.length - 1 && isImporting && tableProgresses.length === 0 ? (
              <Spin className="mt-1 size-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span
              className={cn('break-all', {
                'text-amber-600': log.type === 'warning',
                'text-green-500': log.type === 'done',
                'text-foreground': log.type === 'info' && i === normalLogs.length - 1,
                'text-muted-foreground': log.type === 'info' && i !== normalLogs.length - 1,
              })}
            >
              {log.message}
            </span>
          </div>
        ))}
        {tableProgresses.length > 0 && (
          <div className="mt-3 space-y-2 font-sans">
            {tableProgresses.map((progress) => (
              <TableProgressCard key={progress.tableId} progress={progress} t={tAny} />
            ))}
          </div>
        )}
        {errorLogs.map((log, i) => (
          <div key={log.timestamp + i} className="mt-2 flex items-start gap-2">
            <AlertCircle className="mt-1 size-3.5 shrink-0 text-destructive" />
            <span className="break-all text-destructive">{log.message}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};
