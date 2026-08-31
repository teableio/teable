import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GoogleSheet } from '@teable/icons';
import {
  getUserIntegrationList,
  importGoogleSheetAnalyze,
  ImportGoogleSheetStreamError,
  importGoogleSheetStream,
  UserIntegrationProvider,
  type IImportGoogleSheetAnalyzeVo,
  type IImportGoogleSheetIssue,
  type IImportGoogleSheetProgressEvent,
  type IImportGoogleSheetVo,
  type IUserIntegrationItemVo,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/index';
import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useConnectIntegration } from '@/features/app/components/user-integration/useConnectIntegration';
import { spaceConfig } from '@/features/i18n/space.config';
import {
  ImportLogPanel,
  type ILogEntry,
  type ITableImportProgress,
} from '../upload-panel/ImportLogPanel';
import { openSpreadsheetPicker, preloadPickerApi } from './google-picker';
import { GoogleSheetPickEmptyState } from './GoogleSheetPickEmptyState';
import { fetchPickerPrereqs } from './picker-prereqs';

const MAX_ISSUE_LOGS = 30;

type IStep = 'detect' | 'connect' | 'pick' | 'import';

type ISpreadsheet = IImportGoogleSheetAnalyzeVo['spreadsheet'];

interface IGoogleSheetImportDialogProps {
  spaceId: string;
  /** When set, import the spreadsheet's tabs into this existing base instead of creating a new one. */
  baseId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PHASE_I18N_MAP: Record<string, string> = {
  fetching_schema: 'space:googleSheetImport.phase.fetchingSchema',
  creating_base: 'space:googleSheetImport.phase.creatingBase',
  creating_table: 'space:googleSheetImport.phase.creatingTable',
  // import_done intentionally omitted: a single green "done" line is appended
  // after the issues summary, so mapping this phase too would duplicate it.
};

const ISSUE_I18N_MAP: Record<IImportGoogleSheetIssue['code'], string> = {
  valuesDropped: 'space:googleSheetImport.issue.valuesDropped',
  sheetSkipped: 'space:googleSheetImport.issue.sheetSkipped',
  columnsTruncated: 'space:googleSheetImport.issue.columnsTruncated',
};

export const GoogleSheetImportDialog = (props: IGoogleSheetImportDialogProps) => {
  const { spaceId, baseId, open, onOpenChange } = props;
  const { t, i18n } = useTranslation(spaceConfig.i18nNamespaces);
  // t() expects compile-time literal keys; phase/issue keys are runtime strings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tAny = t as (key: string, options?: Record<string, any>) => string;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = React.useState<IStep>('detect');
  const [integration, setIntegration] = React.useState<IUserIntegrationItemVo | null>(null);
  const [spreadsheet, setSpreadsheet] = React.useState<ISpreadsheet | null>(null);
  const [selectedSheetIds, setSelectedSheetIds] = React.useState<number[]>([]);
  const [importRecords, setImportRecords] = React.useState(true);
  // The Google Picker is a full-screen widget outside this dialog; while it is
  // up the dialog is hidden (unmounted) so the two never fight over focus.
  const [isPicking, setIsPicking] = React.useState(false);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [logs, setLogs] = React.useState<ILogEntry[]>([]);
  const [tableProgresses, setTableProgresses] = React.useState<
    Record<string, ITableImportProgress>
  >({});
  const [createdBase, setCreatedBase] = React.useState<IImportGoogleSheetVo['base'] | null>(null);

  const resetState = React.useCallback(() => {
    setStep('detect');
    setIntegration(null);
    setSpreadsheet(null);
    setSelectedSheetIds([]);
    setImportRecords(true);
    setIsPicking(false);
    setIsAnalyzing(false);
    setIsImporting(false);
    setLogs([]);
    setTableProgresses({});
    setCreatedBase(null);
  }, []);

  // The user-integration endpoints are EE-only; when they are unavailable the
  // dialog explains that the Google Sheets integration is not configured.
  const {
    data: detectedIntegration,
    isFetching: isDetectingFetch,
    error: detectError,
  } = useQuery({
    queryKey: [...ReactQueryKeys.getUserIntegrations(), 'google-sheet-import'],
    enabled: open,
    retry: false,
    queryFn: async () =>
      (
        await getUserIntegrationList({ provider: UserIntegrationProvider.GoogleSheet })
      ).data.integrations.find((item) => item.hasSecret) ?? null,
  });
  // Only a 404 means the endpoints genuinely don't exist (community edition /
  // integrations not deployed). Any other failure is transient — the terminal
  // "ask an administrator" message would misdiagnose a configured instance
  // over a network blip; fall through to the connect step instead.
  const detectStatus = (detectError as { status?: number } | null)?.status;
  const integrationUnavailable = detectStatus === 404;

  // OAuth connect with auto-close handled by the shared hook; on success we read
  // back the freshly-connected integration and jump straight to the picker step.
  const { connect, isConnecting } = useConnectIntegration({
    onConnected: async () => {
      const found =
        (
          await getUserIntegrationList({ provider: UserIntegrationProvider.GoogleSheet })
        ).data.integrations.find((item) => item.hasSecret) ?? null;
      if (found) {
        setIntegration(found);
        setStep('pick');
      }
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    // closeable={!isImporting} only hides the X — Escape and overlay clicks
    // still fire; closing mid-import would wipe the progress/issues view
    // while the server import keeps running.
    if (!nextOpen && isImporting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      // Invalidate any in-flight analyze so its late response cannot
      // repopulate state after this reset.
      pickSessionRef.current += 1;
      resetState();
    }
  };

  const addLog = React.useCallback((message: string, type: ILogEntry['type'] = 'info') => {
    setLogs((prev) => [...prev, { message, type, timestamp: Date.now() }]);
  }, []);

  // Warm the Google Picker script while the user is still connecting/deciding:
  // its cold load is seconds of invisible latency if left to the click.
  React.useEffect(() => {
    if (open) preloadPickerApi();
  }, [open]);

  // Drive the detect step: a pre-existing integration -> straight to the picker
  // step, none -> connect step. The post-OAuth transition is handled by
  // useConnectIntegration's onConnected.
  React.useEffect(() => {
    if (!open || isDetectingFetch || step !== 'detect') return;
    if (detectedIntegration) {
      setIntegration(detectedIntegration);
      setStep('pick');
    } else {
      setStep('connect');
    }
  }, [open, isDetectingFetch, detectedIntegration, step]);

  /**
   * Open the Google Picker: fetch the public picker config plus a short-lived
   * access token for THIS provider (drive.file scope only), hand both to
   * Google's widget, then summarize the picked spreadsheet's tabs.
   */
  // Bumped on every dialog close; async pick/analyze results from an older
  // session are discarded instead of resurrecting cleared state.
  const pickSessionRef = React.useRef(0);

  const handlePickSpreadsheet = async () => {
    if (!integration || isPicking) return;
    const pickSession = pickSessionRef.current;
    setIsPicking(true);
    // Only a failed token request (revoked / unrefreshable grant) routes back
    // to the connect step — see fetchPickerPrereqs. Config or Picker-script
    // failures keep the healthy integration on the pick step for a retry.
    const prereqs = await fetchPickerPrereqs(integration.id);
    if (prereqs.status === 'tokenFailed') {
      setIsPicking(false);
      toast.error(
        prereqs.reason instanceof Error
          ? prereqs.reason.message
          : t('space:googleSheetImport.failed')
      );
      setIntegration(null);
      setStep('connect');
      return;
    }
    let picked: { id: string }[] | undefined;
    try {
      if (prereqs.status === 'configFailed') {
        throw prereqs.reason;
      }
      picked = await openSpreadsheetPicker({
        accessToken: prereqs.accessToken,
        apiKey: prereqs.apiKey,
        appId: prereqs.appId,
        locale: i18n.language,
      });
    } catch (error) {
      setIsPicking(false);
      toast.error(error instanceof Error ? error.message : t('space:googleSheetImport.failed'));
      return;
    }
    // Bring the dialog back before the (short) analyze round-trip.
    setIsPicking(false);
    if (!picked?.length || pickSession !== pickSessionRef.current) return;
    await analyzePickedSpreadsheet(integration.id, picked[0].id, pickSession);
  };

  /** List the picked spreadsheet's tabs; stale pick sessions are discarded. */
  const analyzePickedSpreadsheet = async (
    integrationId: string,
    spreadsheetId: string,
    pickSession: number
  ) => {
    setIsAnalyzing(true);
    try {
      const { data } = await importGoogleSheetAnalyze({ integrationId, spreadsheetId });
      if (pickSession !== pickSessionRef.current) return;
      setSpreadsheet(data.spreadsheet);
      setSelectedSheetIds(data.spreadsheet.sheets.map((sheet) => sheet.sheetId));
    } catch (error) {
      if (pickSession === pickSessionRef.current) {
        // Clear any PREVIOUS spreadsheet too: keeping A on 'replace with B
        // failed' leaves an import button armed for a target the user just
        // tried to switch away from.
        setSpreadsheet(null);
        setSelectedSheetIds([]);
        toast.error(error instanceof Error ? error.message : t('space:googleSheetImport.failed'));
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleSheet = (sheetId: number) => {
    setSelectedSheetIds((previous) =>
      previous.includes(sheetId) ? previous.filter((id) => id !== sheetId) : [...previous, sheetId]
    );
  };

  const translatePhase = React.useCallback(
    (event: IImportGoogleSheetProgressEvent) => {
      const i18nKey = PHASE_I18N_MAP[event.phase];
      if (!i18nKey) return undefined;
      return tAny(i18nKey, {
        detail: event.detail,
        tableName: event.tableName,
        tableIndex: event.tableIndex,
        totalTables: event.totalTables,
      });
    },
    [tAny]
  );

  const updateTableProgress = React.useCallback((event: IImportGoogleSheetProgressEvent) => {
    const tableName = event.tableName;
    if (!tableName) return;
    const key = `records:${tableName}`;
    setTableProgresses((previous) => ({
      ...previous,
      [key]: {
        tableId: key,
        tableName,
        processedRows: event.processedRows ?? previous[key]?.processedRows ?? 0,
        totalRows: event.totalRows ?? previous[key]?.totalRows,
        status: event.phase === 'table_records_done' ? 'done' : 'running',
      },
    }));
  }, []);

  const logIssues = React.useCallback(
    (issues: IImportGoogleSheetIssue[]) => {
      if (issues.length === 0) return;
      addLog(t('space:googleSheetImport.issuesSummary', { count: issues.length }), 'warning');
      for (const issue of issues.slice(0, MAX_ISSUE_LOGS)) {
        addLog(tAny(ISSUE_I18N_MAP[issue.code], { ...issue }), 'warning');
      }
      if (issues.length > MAX_ISSUE_LOGS) {
        addLog(
          t('space:googleSheetImport.issuesMore', { count: issues.length - MAX_ISSUE_LOGS }),
          'warning'
        );
      }
    },
    [addLog, t, tAny]
  );

  const handleProgressEvent = React.useCallback(
    (event: IImportGoogleSheetProgressEvent) => {
      if (
        event.phase === 'table_records_start' ||
        event.phase === 'table_records_progress' ||
        event.phase === 'table_records_done'
      ) {
        updateTableProgress(event);
        if (event.phase === 'table_records_done' && event.tableName) {
          // The bar tracks scanned grid rows (padding included); this line
          // reports what actually landed in the table.
          addLog(
            t('space:googleSheetImport.recordsImported', {
              tableName: event.tableName,
              count: event.importedRecords ?? 0,
            })
          );
        }
        return;
      }
      const message = translatePhase(event);
      if (message) addLog(message);
    },
    [updateTableProgress, translatePhase, addLog, t]
  );

  /** After a mid-import failure: keep and surface whatever was fully imported. */
  const logPartialFailure = React.useCallback(
    (error: unknown) => {
      const partial = error instanceof ImportGoogleSheetStreamError ? error.partial : undefined;
      if (!partial) return;
      logIssues(partial.issues);
      const importedTables = Object.keys(partial.tableIdMap).length;
      if (importedTables > 0) {
        addLog(t('space:googleSheetImport.partialImported', { count: importedTables }), 'warning');
      }
      if (partial.base) {
        setCreatedBase(partial.base);
        // The kept base/tables exist server-side; without invalidation the
        // space page would not show them until a manual reload.
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId) });
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      }
    },
    [logIssues, addLog, t, queryClient, spaceId]
  );

  const handleImport = async () => {
    if (!spreadsheet || !integration || selectedSheetIds.length === 0) return;

    setStep('import');
    setIsImporting(true);
    try {
      const { data } = await importGoogleSheetStream(
        {
          spaceId,
          ...(baseId ? { baseId } : {}),
          integrationId: integration.id,
          spreadsheetId: spreadsheet.id,
          baseName: spreadsheet.title,
          sheetIds: selectedSheetIds,
          importRecords,
        },
        (_phase, _detail, event) => event && handleProgressEvent(event)
      );
      setTableProgresses((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([key, progress]) => [
            key,
            { ...progress, status: 'done' as const },
          ])
        )
      );
      logIssues(data.issues);
      addLog(t('space:googleSheetImport.done'), 'done');
      setCreatedBase(data.base);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      toast.success(t('space:googleSheetImport.done'), { description: data.base.name });
    } catch (error) {
      addLog(error instanceof Error ? error.message : t('space:googleSheetImport.failed'), 'error');
      logPartialFailure(error);
    } finally {
      setIsImporting(false);
    }
  };

  const canImport = !!spreadsheet && selectedSheetIds.length > 0 && !isAnalyzing;

  return (
    <Dialog open={open && !isPicking} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl" closeable={!isImporting}>
        <DialogHeader>
          <DialogTitle>{t('space:googleSheetImport.title')}</DialogTitle>
        </DialogHeader>

        {step === 'detect' && (
          <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spin className="size-4" />
            {t('space:googleSheetImport.detecting')}
          </div>
        )}

        {step === 'connect' &&
          (integrationUnavailable ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t('space:googleSheetImport.integrationRequired')}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <GoogleSheet className="size-10" />
              <Button
                onClick={() =>
                  connect(UserIntegrationProvider.GoogleSheet, { name: 'Google Sheets' })
                }
                disabled={isConnecting}
              >
                {isConnecting && <Spin className="me-1 size-4" />}
                {isConnecting
                  ? t('space:googleSheetImport.waitingOAuth')
                  : t('space:googleSheetImport.connectWithGoogle')}
              </Button>
            </div>
          ))}

        {step === 'pick' && (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <Label>{t('space:googleSheetImport.pickSpreadsheet')}</Label>
              {integration && (
                <span className="text-xs text-muted-foreground">
                  {t('space:googleSheetImport.connectedAs', {
                    account: integration.metadata?.userInfo?.email ?? integration.name,
                  })}
                </span>
              )}
            </div>

            {isAnalyzing ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spin className="size-4" />
                {t('space:googleSheetImport.analyzing')}
              </div>
            ) : !spreadsheet ? (
              <GoogleSheetPickEmptyState onPick={handlePickSpreadsheet} />
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <GoogleSheet className="size-6 shrink-0" />
                    <div className="truncate text-sm font-medium">{spreadsheet.title}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handlePickSpreadsheet}>
                    {t('space:googleSheetImport.changeSpreadsheet')}
                  </Button>
                </div>
                <div>
                  <Label>{t('space:googleSheetImport.pickTabs')}</Label>
                  <div className="mt-2 grid max-h-60 grid-cols-2 content-start gap-2 overflow-y-auto pe-1">
                    {spreadsheet.sheets.map((sheet) => {
                      const checked = selectedSheetIds.includes(sheet.sheetId);
                      return (
                        <button
                          key={sheet.sheetId}
                          type="button"
                          onClick={() => toggleSheet(sheet.sheetId)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border p-2.5 text-start transition-colors',
                            checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                          )}
                        >
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <GoogleSheet className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{sheet.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {t('space:googleSheetImport.gridSize', {
                                rows: sheet.rowCount,
                                columns: sheet.columnCount,
                              })}
                            </div>
                          </div>
                          {checked && <Check className="size-4 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Label className="flex cursor-pointer items-center gap-2 font-normal">
                  <Checkbox
                    checked={importRecords}
                    onCheckedChange={(checked) => setImportRecords(checked === true)}
                  />
                  {t('space:googleSheetImport.optionRecords')}
                </Label>
              </>
            )}
          </div>
        )}

        {step === 'import' && (
          <div className="relative h-72">
            <ImportLogPanel
              logs={logs}
              tableProgresses={Object.values(tableProgresses)}
              isImporting={isImporting}
            />
          </div>
        )}

        <DialogFooter>
          {(step === 'detect' || step === 'connect') && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
          )}
          {step === 'pick' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t('common:actions.cancel')}
              </Button>
              {/* Before a spreadsheet is picked the pick card is the only
                  action — a disabled import button next to it is just noise. */}
              {spreadsheet && (
                <Button onClick={handleImport} disabled={!canImport}>
                  {t('space:googleSheetImport.import')}
                </Button>
              )}
            </>
          )}
          {step === 'import' && (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isImporting}
              >
                {t('space:googleSheetImport.close')}
              </Button>
              {/* Importing into the current base: the user is already here, so only offer
                  "open base" for the new-base flow. */}
              {!baseId && createdBase && (
                <Button
                  onClick={() => {
                    handleOpenChange(false);
                    router.push({ pathname: '/base/[baseId]', query: { baseId: createdBase.id } });
                  }}
                >
                  {t('space:googleSheetImport.openBase')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
