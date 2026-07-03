import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Airtable, Check, HelpCircle, Search } from '@teable/icons';
import {
  getUserIntegrationList,
  importAirtableAnalyze,
  importAirtableStream,
  UserIntegrationProvider,
  type IImportAirtableIssue,
  type IImportAirtableProgressEvent,
  type IImportAirtableVo,
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
  Input,
  Label,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
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

const MAX_ISSUE_LOGS = 30;

// Airtable-like base tile colors, picked deterministically per base id.
const BASE_TILE_COLORS = [
  'bg-blue-500',
  'bg-teal-500',
  'bg-emerald-600',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-cyan-600',
  'bg-orange-500',
];

const getBaseTileColor = (baseId: string) => {
  let hash = 0;
  for (let i = 0; i < baseId.length; i++) {
    hash = (hash + baseId.charCodeAt(i)) % BASE_TILE_COLORS.length;
  }
  return BASE_TILE_COLORS[hash];
};

const getBaseInitials = (name: string) => name.trim().slice(0, 2);

type IStep = 'detect' | 'connect' | 'pick' | 'import';

interface IAirtableImportDialogProps {
  spaceId: string;
  /** When set, import the Airtable base's tables into this existing base instead of creating a new one. */
  baseId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Opt-in import of view filters/sorts/grouping via a public shared-base link. */
const ViewConfigImportOption = (props: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  shareLink: string;
  onShareLinkChange: (value: string) => void;
  mismatch: boolean;
}) => {
  const { enabled, onEnabledChange, shareLink, onShareLinkChange, mismatch } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Label className="flex cursor-pointer items-center gap-2 font-normal">
          <Checkbox
            checked={enabled}
            onCheckedChange={(checked) => onEnabledChange(checked === true)}
          />
          {t('space:airtableImport.optionViewConfig')}
        </Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('space:airtableImport.viewConfig.help')}
                className="flex shrink-0 cursor-help text-muted-foreground transition-colors hover:text-foreground"
              >
                <HelpCircle className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent align="start" className="max-w-xs">
                <p>{t('space:airtableImport.viewConfig.help')}</p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                  <li>{t('space:airtableImport.viewConfig.helpStep1')}</li>
                  <li>{t('space:airtableImport.viewConfig.helpStep2')}</li>
                  <li>{t('space:airtableImport.viewConfig.helpStep3')}</li>
                </ol>
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </TooltipProvider>
      </div>
      {enabled && (
        <div className="ml-6 space-y-1.5">
          <Input
            value={shareLink}
            placeholder={t('space:airtableImport.viewConfig.linkPlaceholder')}
            onChange={(e) => onShareLinkChange(e.target.value)}
          />
          {mismatch && (
            <p className="text-xs text-destructive">
              {t('space:airtableImport.viewConfig.mismatch')}
            </p>
          )}
        </div>
      )}
    </>
  );
};

const PHASE_I18N_MAP: Record<string, string> = {
  fetching_schema: 'space:airtableImport.phase.fetchingSchema',
  creating_base: 'space:airtableImport.phase.creatingBase',
  creating_table: 'space:airtableImport.phase.creatingTable',
  creating_links: 'space:airtableImport.phase.creatingLinks',
  applying_view_config: 'space:airtableImport.phase.applyingViewConfig',
  // import_done intentionally omitted: a single green "done" line is appended
  // after the issues summary, so mapping this phase too would duplicate it.
};

const ISSUE_I18N_MAP: Record<IImportAirtableIssue['code'], string> = {
  fieldDegraded: 'space:airtableImport.issue.fieldDegraded',
  fieldSkipped: 'space:airtableImport.issue.fieldSkipped',
  viewSkipped: 'space:airtableImport.issue.viewSkipped',
  valuesDropped: 'space:airtableImport.issue.valuesDropped',
  viewConfigDegraded: 'space:airtableImport.issue.viewConfigDegraded',
};

// Airtable's canonical share URL embeds the base (app) id, letting us flag a
// mismatched link before the import runs; the server validates authoritatively.
const parseShareLinkBaseId = (shareLink: string) => shareLink.match(/app[A-Za-z0-9]+/)?.[0];

const evaluateShareLink = (
  importViewConfig: boolean,
  shareLink: string,
  selectedBaseId: string
) => {
  const trimmed = shareLink.trim();
  const linkBaseId = parseShareLinkBaseId(trimmed);
  const mismatch = importViewConfig && !!trimmed && !!linkBaseId && linkBaseId !== selectedBaseId;
  const canImport = !!selectedBaseId && (!importViewConfig || (!!trimmed && !mismatch));
  return { mismatch, canImport };
};

export const AirtableImportDialog = (props: IAirtableImportDialogProps) => {
  const { spaceId, baseId, open, onOpenChange } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  // t() expects compile-time literal keys; phase/issue keys are runtime strings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tAny = t as (key: string, options?: Record<string, any>) => string;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = React.useState<IStep>('detect');
  const [integration, setIntegration] = React.useState<IUserIntegrationItemVo | null>(null);
  const [baseSearch, setBaseSearch] = React.useState('');
  const [selectedBaseId, setSelectedBaseId] = React.useState('');
  const [importRecords, setImportRecords] = React.useState(true);
  const [importAttachments, setImportAttachments] = React.useState(true);
  const [importViewConfig, setImportViewConfig] = React.useState(false);
  const [shareLink, setShareLink] = React.useState('');
  const [isImporting, setIsImporting] = React.useState(false);
  const [logs, setLogs] = React.useState<ILogEntry[]>([]);
  const [tableProgresses, setTableProgresses] = React.useState<
    Record<string, ITableImportProgress>
  >({});
  const [createdBase, setCreatedBase] = React.useState<IImportAirtableVo['base'] | null>(null);

  const resetState = React.useCallback(() => {
    setStep('detect');
    setIntegration(null);
    setBaseSearch('');
    setSelectedBaseId('');
    setImportRecords(true);
    setImportAttachments(true);
    setImportViewConfig(false);
    setShareLink('');
    setIsImporting(false);
    setLogs([]);
    setTableProgresses({});
    setCreatedBase(null);
  }, []);

  // The user-integration endpoints are EE-only; when they are unavailable the
  // dialog explains that the Airtable integration is not configured.
  const {
    data: detectedIntegration,
    isFetching: isDetectingFetch,
    isError: integrationUnavailable,
  } = useQuery({
    // Key the detection under the canonical user-integrations namespace so that
    // disconnecting an integration (which invalidates getUserIntegrations() by
    // prefix) also marks this stale — otherwise the deleted integration lingers
    // in cache and the dialog jumps straight to a base list that 404s.
    queryKey: [...ReactQueryKeys.getUserIntegrations(), 'airtable-import'],
    enabled: open,
    retry: false,
    queryFn: async () =>
      (
        await getUserIntegrationList({ provider: UserIntegrationProvider.Airtable })
      ).data.integrations.find((item) => item.hasSecret) ?? null,
  });

  // OAuth connect with auto-close handled by the shared hook; on success we read
  // back the freshly-connected integration and jump straight to the base picker.
  const { connect, isConnecting } = useConnectIntegration({
    onConnected: async () => {
      const found =
        (
          await getUserIntegrationList({ provider: UserIntegrationProvider.Airtable })
        ).data.integrations.find((item) => item.hasSecret) ?? null;
      if (found) {
        setIntegration(found);
        setStep('pick');
      }
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      resetState();
    }
  };

  const addLog = React.useCallback((message: string, type: ILogEntry['type'] = 'info') => {
    setLogs((prev) => [...prev, { message, type, timestamp: Date.now() }]);
  }, []);

  // Drive the detect step: a pre-existing integration -> straight to the base
  // picker (which loads the base list itself), none -> connect step. The
  // post-OAuth transition is handled by useConnectIntegration's onConnected.
  React.useEffect(() => {
    // Wait for a settled fetch (not just non-loading): a 10s default staleTime
    // means a freshly invalidated query still serves the previous value while
    // it revalidates, and acting on that stale value reintroduces the deleted
    // integration we are trying to detect away.
    if (!open || isDetectingFetch || step !== 'detect') return;
    if (detectedIntegration) {
      setIntegration(detectedIntegration);
      setStep('pick');
    } else {
      setStep('connect');
    }
  }, [open, isDetectingFetch, detectedIntegration, step]);

  // The integration's access token is resolved server-side; it never reaches
  // the browser. react-query dedupes the call across re-renders.
  const {
    data: bases = [],
    isLoading: isLoadingBases,
    error: basesError,
  } = useQuery({
    queryKey: ['airtable-import-bases', integration?.id],
    enabled: open && !!integration && step === 'pick',
    retry: false,
    queryFn: async () => {
      const { data } = await importAirtableAnalyze({ integrationId: integration!.id });
      // The Airtable API does not expose workspace grouping; keep the list
      // stable by sorting alphabetically.
      return (data.bases ?? []).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  React.useEffect(() => {
    if (!basesError) return;
    toast.error(
      basesError instanceof Error ? basesError.message : t('space:airtableImport.failed')
    );
    setIntegration(null);
    setStep('connect');
  }, [basesError, t]);

  // Preselect the first base once the list arrives.
  React.useEffect(() => {
    if (step === 'pick' && !selectedBaseId && bases.length > 0) {
      setSelectedBaseId(bases[0].id);
    }
  }, [step, selectedBaseId, bases]);

  const translatePhase = React.useCallback(
    (event: IImportAirtableProgressEvent) => {
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

  const updateTableProgress = React.useCallback(
    (event: IImportAirtableProgressEvent) => {
      const tableName = event.tableName;
      if (!tableName) return;
      const isLinkPhase = event.phase === 'filling_links';
      const key = isLinkPhase ? `links:${tableName}` : `records:${tableName}`;
      setTableProgresses((previous) => ({
        ...previous,
        [key]: {
          tableId: key,
          tableName: isLinkPhase
            ? tAny('space:airtableImport.phase.fillingLinks', { tableName })
            : tableName,
          processedRows: event.processedRows ?? previous[key]?.processedRows ?? 0,
          status: event.phase === 'table_records_done' ? 'done' : 'running',
        },
      }));
    },
    [tAny]
  );

  const logIssues = React.useCallback(
    (issues: IImportAirtableIssue[]) => {
      if (issues.length === 0) return;
      addLog(t('space:airtableImport.issuesSummary', { count: issues.length }), 'warning');
      for (const issue of issues.slice(0, MAX_ISSUE_LOGS)) {
        addLog(tAny(ISSUE_I18N_MAP[issue.code], { ...issue }), 'warning');
      }
      if (issues.length > MAX_ISSUE_LOGS) {
        addLog(
          t('space:airtableImport.issuesMore', { count: issues.length - MAX_ISSUE_LOGS }),
          'warning'
        );
      }
    },
    [addLog, t, tAny]
  );

  const handleImport = async () => {
    const base = bases.find((candidate) => candidate.id === selectedBaseId);
    if (!base || !integration) return;

    setStep('import');
    setIsImporting(true);
    try {
      const { data } = await importAirtableStream(
        {
          spaceId,
          ...(baseId ? { baseId } : {}),
          integrationId: integration.id,
          airtableBaseId: base.id,
          baseName: base.name,
          importRecords,
          importAttachments: importRecords && importAttachments,
          ...(importViewConfig && shareLink.trim()
            ? { importViewConfig: true, shareLink: shareLink.trim() }
            : {}),
        },
        (_phase, _detail, event) => {
          if (!event) return;
          if (
            event.phase === 'table_records_start' ||
            event.phase === 'table_records_progress' ||
            event.phase === 'table_records_done' ||
            event.phase === 'filling_links'
          ) {
            updateTableProgress(event);
            return;
          }
          const message = translatePhase(event);
          if (message) addLog(message);
        }
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
      if (importViewConfig) {
        addLog(t('space:airtableImport.viewConfig.disableReminder'), 'info');
      }
      addLog(t('space:airtableImport.done'), 'done');
      setCreatedBase(data.base);
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseList(spaceId) });
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseAll() });
      toast.success(t('space:airtableImport.done'), { description: data.base.name });
    } catch (error) {
      addLog(error instanceof Error ? error.message : t('space:airtableImport.failed'), 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const filteredBases = React.useMemo(() => {
    const query = baseSearch.trim().toLowerCase();
    if (!query) return bases;
    return bases.filter((base) => base.name.toLowerCase().includes(query));
  }, [bases, baseSearch]);

  // A link that carries a different base id is surely wrong; warn before import.
  const { mismatch: shareLinkMismatch, canImport } = React.useMemo(
    () => evaluateShareLink(importViewConfig, shareLink, selectedBaseId),
    [importViewConfig, shareLink, selectedBaseId]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl" closeable={!isImporting}>
        <DialogHeader>
          <DialogTitle>{t('space:airtableImport.title')}</DialogTitle>
        </DialogHeader>

        {step === 'detect' && (
          <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spin className="size-4" />
            {t('space:airtableImport.detecting')}
          </div>
        )}

        {step === 'connect' &&
          (integrationUnavailable ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t('space:airtableImport.integrationRequired')}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <Airtable className="size-10" />
              <Button
                onClick={() => connect(UserIntegrationProvider.Airtable, { name: 'Airtable' })}
                disabled={isConnecting}
              >
                {isConnecting && <Spin className="mr-1 size-4" />}
                {isConnecting
                  ? t('space:airtableImport.waitingOAuth')
                  : t('space:airtableImport.connectWithAirtable')}
              </Button>
            </div>
          ))}

        {step === 'pick' && (
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <Label>{t('space:airtableImport.pickBase')}</Label>
                {integration && (
                  <span className="text-xs text-muted-foreground">
                    {t('space:airtableImport.connectedAs', {
                      account: integration.metadata?.userInfo?.email ?? integration.name,
                    })}
                  </span>
                )}
              </div>
              {bases.length === 0 && !isLoadingBases ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('space:airtableImport.noBases')}
                </p>
              ) : (
                <>
                  {/* Search bar and grid stay mounted while loading so swapping
                      skeleton tiles for real ones never shifts the dialog height. */}
                  <div className="relative mt-2">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      value={baseSearch}
                      disabled={isLoadingBases}
                      placeholder={t('space:airtableImport.searchBases')}
                      onChange={(e) => setBaseSearch(e.target.value)}
                    />
                  </div>
                  {isLoadingBases ? (
                    <div className="mt-3 grid max-h-72 grid-cols-2 content-start gap-2 overflow-y-auto pr-1">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-2.5 rounded-lg border p-2.5"
                        >
                          <Skeleton className="size-9 shrink-0 rounded-lg" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-2/3" />
                            <Skeleton className="h-3 w-1/3" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredBases.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t('space:airtableImport.noSearchResults')}
                    </p>
                  ) : (
                    <div className="mt-3 grid max-h-72 grid-cols-2 content-start gap-2 overflow-y-auto pr-1">
                      {filteredBases.map((base) => (
                        <button
                          key={base.id}
                          type="button"
                          onClick={() => setSelectedBaseId(base.id)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                            selectedBaseId === base.id
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50'
                          )}
                        >
                          <div
                            className={cn(
                              'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium text-white',
                              getBaseTileColor(base.id)
                            )}
                          >
                            {getBaseInitials(base.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{base.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {tAny(
                                `space:airtableImport.permission.${base.permissionLevel}`,
                                // Defensive default for future Airtable permission levels
                                { defaultValue: base.permissionLevel }
                              )}
                            </div>
                          </div>
                          {selectedBaseId === base.id && (
                            <Check className="size-4 shrink-0 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label className="flex cursor-pointer items-center gap-2 font-normal">
                <Checkbox
                  checked={importRecords}
                  onCheckedChange={(checked) => setImportRecords(checked === true)}
                />
                {t('space:airtableImport.optionRecords')}
              </Label>
              <Label className="flex cursor-pointer items-center gap-2 font-normal">
                <Checkbox
                  checked={importRecords && importAttachments}
                  disabled={!importRecords}
                  onCheckedChange={(checked) => setImportAttachments(checked === true)}
                />
                {t('space:airtableImport.optionAttachments')}
              </Label>
              <ViewConfigImportOption
                enabled={importViewConfig}
                onEnabledChange={setImportViewConfig}
                shareLink={shareLink}
                onShareLinkChange={setShareLink}
                mismatch={shareLinkMismatch}
              />
            </div>
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
          {step === 'detect' && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
          )}
          {step === 'connect' && (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
          )}
          {step === 'pick' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button onClick={handleImport} disabled={!canImport}>
                {t('space:airtableImport.import')}
              </Button>
            </>
          )}
          {step === 'import' && (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isImporting}
              >
                {t('space:airtableImport.close')}
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
                  {t('space:airtableImport.openBase')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
