import {
  streamV2BaseSchemaIntegrityCheck,
  streamV2BaseSchemaIntegrityRepair,
  streamV2TableSchemaIntegrityCheck,
  streamV2TableSchemaIntegrityRepair,
} from '@teable/openapi';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IntegrityActions,
  IntegrityResultsPanel,
  IntegrityStatusFilters,
  SummaryBadges,
} from './IntegrityV2Components';
import {
  createSummary,
  filterResultsByStatuses,
  getDialogDescription,
  getErrorMessage,
  groupResults,
  groupResultsByTable,
  integrityFilterStatuses,
  type IntegrityFilterStatus,
  type IntegrityPhase,
  type IntegrityResult,
  type IntegrityScope,
  type IntegritySummary,
  type Translate,
  upsertResult,
} from './integrityV2Utils';

export const IntegrityV2Dialog = ({
  baseId,
  baseName,
  tableId,
  tableName,
}: {
  baseId?: string;
  baseName?: string;
  tableId?: string;
  tableName?: string;
}) => {
  const { t } = useTranslation(['table', 'common']);
  const scope: IntegrityScope = tableId ? 'table' : 'base';
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<IntegrityPhase>('check');
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [results, setResults] = useState<IntegrityResult[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastCheckSummary, setLastCheckSummary] = useState<IntegritySummary | null>(null);
  const [selectedStatuses, setSelectedStatuses] =
    useState<IntegrityFilterStatus[]>(integrityFilterStatuses);
  const abortRef = useRef<AbortController | null>(null);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  const runCheck = useCallback(async () => {
    if (!baseId) {
      return;
    }

    stopStream();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('check');
    setHasRun(true);
    setIsRunning(true);
    setStreamError(null);
    setResults([]);

    let nextResults: IntegrityResult[] = [];

    try {
      const onResult = (result: IntegrityResult) => {
        nextResults = upsertResult(nextResults, result);
        setResults((currentResults) => upsertResult(currentResults, result));
      };

      if (scope === 'table' && tableId) {
        await streamV2TableSchemaIntegrityCheck(tableId, {
          signal: controller.signal,
          onResult,
        });
      } else {
        await streamV2BaseSchemaIntegrityCheck(baseId, {
          signal: controller.signal,
          onResult,
        });
      }

      setLastCheckSummary(createSummary(nextResults));
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = getErrorMessage(error, t('table:table.integrity.v2.streamError'));
        setStreamError(message);
        toast.error(message);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsRunning(false);
      }
    }
  }, [baseId, scope, stopStream, t, tableId]);

  const runRepair = useCallback(async () => {
    if (!baseId) {
      return;
    }

    stopStream();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('repair');
    setHasRun(true);
    setIsRunning(true);
    setStreamError(null);
    setResults([]);

    try {
      const onResult = (result: IntegrityResult) => {
        setResults((currentResults) => upsertResult(currentResults, result));
      };

      if (scope === 'table' && tableId) {
        await streamV2TableSchemaIntegrityRepair(
          tableId,
          {},
          {
            signal: controller.signal,
            onResult,
          }
        );
      } else {
        await streamV2BaseSchemaIntegrityRepair(
          baseId,
          {},
          {
            signal: controller.signal,
            onResult,
          }
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = getErrorMessage(error, t('table:table.integrity.v2.streamError'));
        setStreamError(message);
        toast.error(message);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsRunning(false);
      }
    }
  }, [baseId, scope, stopStream, t, tableId]);

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }

    setStreamError(null);

    if (!baseId) {
      setPhase('check');
      setResults([]);
      setHasRun(false);
      setIsRunning(false);
      return;
    }

    void runCheck();

    return () => {
      stopStream();
    };
  }, [baseId, open, runCheck, stopStream]);

  const summary = createSummary(results);
  const filteredResults = filterResultsByStatuses(results, selectedStatuses);
  const groupedResults = groupResults(filteredResults);
  const tableGroups = groupResultsByTable(filteredResults);
  const canRepair = Boolean(
    baseId && !isRunning && lastCheckSummary && lastCheckSummary.issueCount > 0
  );
  const hasFilteredOutAll = filteredResults.length === 0 && results.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          stopStream();
        }
        setOpen(nextOpen);
      }}
    >
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        {t('table:table.integrity.check')}
      </Button>
      <DialogContent
        className="flex max-w-6xl flex-col gap-0 p-0"
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 80px)' }}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('table:table.integrity.v2.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {getDialogDescription(t as Translate, { baseId, baseName, tableId, tableName })}
          </DialogDescription>
          <SummaryBadges
            summary={summary}
            phase={phase}
            baseId={baseId}
            baseName={baseName}
            tableId={tableId}
            tableName={tableName}
          />
        </DialogHeader>

        <div className="space-y-4 border-b px-6 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <IntegrityActions
              canRun={Boolean(baseId)}
              hasRun={hasRun}
              canRepair={canRepair}
              isRunning={isRunning}
              phase={phase}
              onCheck={() => void runCheck()}
              onRepair={() => void runRepair()}
            />
            <IntegrityStatusFilters
              summary={summary}
              phase={phase}
              selectedStatuses={selectedStatuses}
              onStatusesChange={setSelectedStatuses}
            />
          </div>
          {streamError ? (
            <Alert variant="destructive">
              <AlertDescription>{streamError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          <IntegrityResultsPanel
            scope={scope}
            tableGroups={tableGroups}
            groupedResults={groupedResults}
            hasRun={hasRun}
            isRunning={isRunning}
            phase={phase}
            hasTarget={Boolean(baseId)}
            hasFilteredOutAll={hasFilteredOutAll}
          />
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('common:actions.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
