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
  type ManualRepairValues = Record<string, string | boolean>;
  const { t } = useTranslation(['table', 'common']);
  const scope: IntegrityScope = tableId ? 'table' : 'base';
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<IntegrityPhase>('check');
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [results, setResults] = useState<IntegrityResult[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] =
    useState<IntegrityFilterStatus[]>(integrityFilterStatuses);
  const [activeRepairResultId, setActiveRepairResultId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setActiveRepairResultId(null);
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

  const runRepair = useCallback(
    async (targetStatuses: Array<'warn' | 'error'> = ['warn']) => {
      if (!baseId) {
        return;
      }

      stopStream();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('repair');
      setHasRun(true);
      setIsRunning(true);
      setActiveRepairResultId(null);
      setStreamError(null);
      setResults([]);

      try {
        const onResult = (result: IntegrityResult) => {
          setResults((currentResults) => upsertResult(currentResults, result));
        };

        if (scope === 'table' && tableId) {
          await streamV2TableSchemaIntegrityRepair(
            tableId,
            { targetStatuses },
            {
              signal: controller.signal,
              onResult,
            }
          );
        } else {
          await streamV2BaseSchemaIntegrityRepair(
            baseId,
            { targetStatuses },
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
          setActiveRepairResultId(null);
        }
      }
    },
    [baseId, scope, stopStream, t, tableId]
  );

  const runRuleRepair = useCallback(
    async (result: IntegrityResult, manualRepairValues?: ManualRepairValues) => {
      if (!result.tableId || !result.fieldId) {
        return false;
      }

      stopStream();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('repair');
      setHasRun(true);
      setIsRunning(true);
      setActiveRepairResultId(result.id);
      setStreamError(null);

      try {
        const onResult = (nextResult: IntegrityResult) => {
          setResults((currentResults) => upsertResult(currentResults, nextResult));
        };

        await streamV2TableSchemaIntegrityRepair(
          result.tableId,
          {
            fieldId: result.fieldId,
            ruleId: result.ruleId,
            targetStatuses: ['warn', 'error'],
            manualRepairValues,
          },
          {
            signal: controller.signal,
            onResult,
          }
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = getErrorMessage(error, t('table:table.integrity.v2.streamError'));
          setStreamError(message);
          toast.error(message);
          return false;
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsRunning(false);
          setActiveRepairResultId(null);
        }
      }

      return true;
    },
    [stopStream, t]
  );

  const runRuleRepairDryRun = useCallback(
    async (result: IntegrityResult, manualRepairValues?: ManualRepairValues) => {
      if (!result.tableId) {
        return [];
      }

      stopStream();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsRunning(true);
      setActiveRepairResultId(result.id);
      setStreamError(null);

      const dryRunResults: IntegrityResult[] = [];

      try {
        await streamV2TableSchemaIntegrityRepair(
          result.tableId,
          {
            fieldId: result.fieldId || undefined,
            ruleId: result.fieldId ? result.ruleId : undefined,
            dryRun: true,
            targetStatuses: ['warn', 'error'],
            manualRepairValues,
          },
          {
            signal: controller.signal,
            onResult: (nextResult) => {
              dryRunResults.push(nextResult);
            },
          }
        );
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
          setActiveRepairResultId(null);
        }
      }

      return dryRunResults;
    },
    [stopStream, t]
  );

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
  const canRepairWarnings = Boolean(
    baseId &&
      !isRunning &&
      results.some((result) => result.status === 'warn' && result.repair?.available)
  );
  const canRepairAny = Boolean(
    baseId &&
      !isRunning &&
      results.some(
        (result) =>
          (result.status === 'warn' || result.status === 'error') && result.repair?.available
      )
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
              canRepairWarnings={canRepairWarnings}
              canRepairAny={canRepairAny}
              isRunning={isRunning}
              phase={phase}
              onCheck={() => void runCheck()}
              onRepair={(targetStatuses) => void runRepair(targetStatuses)}
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
            baseId={baseId}
            tableGroups={tableGroups}
            groupedResults={groupedResults}
            hasRun={hasRun}
            isRunning={isRunning}
            phase={phase}
            hasTarget={Boolean(baseId)}
            hasFilteredOutAll={hasFilteredOutAll}
            activeRepairResultId={activeRepairResultId}
            onRepairRule={runRuleRepair}
            onPreviewRepairRule={runRuleRepairDryRun}
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
