import { useQuery } from '@tanstack/react-query';
import { COMPUTE_ACTIVITY_CHANGED, type ITableActionKey } from '@teable/core';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ComputeActivityContext } from '../context/compute-activity/ComputeActivityContext';
import { FieldContext } from '../context/field/FieldContext';
import { applyFieldComputeMeta, type FieldComputeMetaClient } from './apply-field-compute-meta';
import { useBaseId } from './use-base-id';
import { useConnection } from './use-connection';
import { useIsReadOnlyPreview } from './use-is-readonly-preview';
import { useTableId } from './use-table-id';
import { useTableListener } from './use-table-listener';

/** Floor between actual HTTP starts for the same table. */
export const COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS = 1_000;
const COMPUTE_ACTIVITY_ACTIVE_POLL_INTERVAL_MS = 15_000;
const COMPUTE_ACTIVITY_IDLE_POLL_INTERVAL_MS = 60_000;

export type ComputeReliabilityClient = {
  unresolvedCount: number;
  oldestUnresolvedAt: string | null;
  scopeComplete: boolean;
};

export type TableComputeActivityClient = {
  status: 'idle' | 'calculating';
  calculatingFieldCount: number;
  queuedFieldCount?: number;
  recentCompletions?: Array<{ fieldId: string; durationMs: number; completedAt: string }>;
  computeMode?: 'server';
  generation?: number;
  updatedAt?: string;
};

export type ComputeActivityFieldClient = FieldComputeMetaClient & {
  reliability?: ComputeReliabilityClient;
  fieldId?: string;
  tableId?: string;
  queuedAt?: string | null;
  activeTaskCount?: number;
  processingTaskCount?: number;
  batchProgress?: { total: number; completed: number };
  generation?: number;
  updatedAt?: string;
};

type ComputeActivityFieldTransport = Omit<
  ComputeActivityFieldClient,
  'startedAt' | 'lastDurationMs'
> & {
  startedAt?: string | null;
  lastDurationMs?: number | null;
};

const normalizeComputeActivityField = (
  field: ComputeActivityFieldTransport
): ComputeActivityFieldClient => ({
  status: field.status,
  reliability: field.reliability,
  fieldId: field.fieldId,
  tableId: field.tableId,
  estimatedComplexity: field.estimatedComplexity,
  estimatedDirtyRecords: field.estimatedDirtyRecords,
  ...(field.startedAt != null ? { startedAt: field.startedAt } : {}),
  ...(field.lastDurationMs != null ? { lastDurationMs: field.lastDurationMs } : {}),
  lastError: field.lastError,
  queuedAt: field.queuedAt,
  activeTaskCount: field.activeTaskCount,
  processingTaskCount: field.processingTaskCount,
  batchProgress: field.batchProgress,
  generation: field.generation,
  updatedAt: field.updatedAt,
});

type ComputeActivitySnapshotTransport = Omit<ComputeActivitySnapshotClient, 'fields'> & {
  fields: Array<ComputeActivityFieldTransport & { fieldId: string }>;
};

export type ComputeActivityDiagnosticsClient = {
  computeMode: 'server';
  reliability?: ComputeReliabilityClient;
  executionState?: 'running' | 'paused';
  activeFieldCount: number;
  queuedFieldCount: number;
  calculatingFieldCount: number;
  failedFieldCount: number;
  highComplexityFieldCount: number;
  anomalies: Array<{
    fieldId: string;
    kind: string;
    message: string;
    estimatedComplexity?: number;
  }>;
  pause?: {
    effective: boolean;
    blockers: Array<{
      id: string;
      scopeType: 'space' | 'base' | 'table';
      scopeId: string;
      pausedAt: string;
      pausedBy: string | null;
      resumeAt: string | null;
      reason: string | null;
    }>;
    queuedTaskCount: number;
    oldestQueuedAt: string | null;
  };
};

export type ComputeActivitySnapshotClient = {
  observedAt?: string;
  observationState?: 'available' | 'syncing' | 'unavailable';
  tableId: string;
  baseId: string;
  table: TableComputeActivityClient | null;
  fields: Array<ComputeActivityFieldClient & { fieldId: string }>;
  diagnostics: ComputeActivityDiagnosticsClient;
};

type ComputeActivityHttpResponse =
  | { ok: true; data: ComputeActivitySnapshotTransport }
  | { ok: false; error?: { message?: string } };

async function fetchComputeActivity(
  baseId: string,
  tableId: string,
  signal?: AbortSignal
): Promise<ComputeActivitySnapshotClient | null> {
  const params = new URLSearchParams({ baseId, tableId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`/api/v2/tables/getComputeActivity?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('Compute activity unavailable');
    const body = (await res.json()) as ComputeActivityHttpResponse;
    if (!body || !('ok' in body) || !body.ok) throw new Error('Compute activity unavailable');
    return {
      ...body.data,
      fields: body.data.fields.map((field) => ({
        ...normalizeComputeActivityField(field),
        fieldId: field.fieldId,
      })),
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Shared compute-activity state shape (provider + hook). Explicit type avoids circular ReturnType. */
export type IComputeActivityState = {
  snapshot: ComputeActivitySnapshotClient | null;
  tableMeta: TableComputeActivityClient | null;
  fieldMetaById: Record<string, ComputeActivityFieldClient>;
  diagnostics: ComputeActivityDiagnosticsClient | null;
  activeFieldCount: number;
  isFetching: boolean;
  observationState?: 'loading' | 'available' | 'syncing' | 'unavailable';
  refetch: () => unknown;
  /** Increments when activity changes — include in useGridColumns memo deps. */
  revision: number;
};

const mergeFieldMeta = (
  httpFields: ComputeActivitySnapshotClient['fields'] | undefined,
  currentTableId: string | undefined,
  readableFieldIds: ReadonlySet<string>
) => {
  const map: Record<string, ComputeActivityFieldClient> = {};
  for (const field of httpFields ?? []) {
    if (!readableFieldIds.has(field.fieldId)) continue;
    if (field.tableId && field.tableId !== currentTableId) continue;
    map[field.fieldId] = { ...field };
  }
  return map;
};

const getObservationState = (
  enabled: boolean,
  unavailable: boolean,
  hasSnapshot: boolean,
  serverState?: ComputeActivitySnapshotClient['observationState']
): NonNullable<IComputeActivityState['observationState']> => {
  if (!enabled) return 'available';
  if (unavailable) return 'unavailable';
  if (serverState && serverState !== 'available') return serverState;
  return hasSnapshot ? 'available' : 'loading';
};

const snapshotHasActiveOrIssues = (data: ComputeActivitySnapshotClient) =>
  data.fields.some(
    (field) =>
      field.status === 'running' ||
      field.status === 'queued' ||
      field.status === 'failed' ||
      (field.reliability?.unresolvedCount ?? 0) > 0
  ) || (data.diagnostics.reliability?.unresolvedCount ?? 0) > 0;

type PollMode = 'success' | 'failure';

/**
 * Internal subscription implementation. Prefer {@link useComputeActivity} which
 * reuses {@link ComputeActivityProvider} when present.
 */
export function useComputeActivitySubscription(
  options: { enabled?: boolean } = {}
): IComputeActivityState {
  const isReadOnlyPreview = useIsReadOnlyPreview();
  const enabled = (options.enabled ?? true) && !isReadOnlyPreview;
  const baseId = useBaseId();
  const tableId = useTableId();
  const { connection, connected } = useConnection();
  const { fields } = useContext(FieldContext);
  const readableFieldIds = useMemo(
    () => new Set(fields.filter((field) => field.canReadFieldRecord !== false).map(({ id }) => id)),
    [fields]
  );
  const [revision, setRevision] = useState(0);
  const previousConnection = useRef(connected);
  const seenConnected = useRef(connected);
  const generationRef = useRef(0);
  const noticeSeqRef = useRef(0);
  const consumedThroughRef = useRef(0);
  const inFlightRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestStartedAtRef = useRef(0);
  const lastSuccessAtRef = useRef(0);
  const hiddenRef = useRef(false);
  const inactiveRef = useRef(!enabled);
  const baseIdRef = useRef(baseId);
  const tableIdRef = useRef(tableId);
  const activeOrIssuesRef = useRef(false);
  const refetchRef = useRef<() => unknown>(() => undefined);
  const scheduleRefreshRef = useRef<() => void>(() => undefined);
  const reschedulePollRef = useRef<(mode: PollMode) => void>(() => undefined);
  const computeActivityMatches = useMemo<ITableActionKey[]>(() => [COMPUTE_ACTIVITY_CHANGED], []);

  baseIdRef.current = baseId;
  tableIdRef.current = tableId;
  inactiveRef.current = !enabled;

  const clearRefreshTimer = () => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };

  const clearPollTimer = () => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const scheduleRefresh = useCallback(() => {
    if (inactiveRef.current) return;
    if (hiddenRef.current) {
      clearRefreshTimer();
      return;
    }
    if (inFlightRef.current) return;
    if (refreshTimerRef.current !== null) return;
    if (noticeSeqRef.current <= consumedThroughRef.current) return;

    const elapsed = Date.now() - lastRequestStartedAtRef.current;
    const wait =
      lastRequestStartedAtRef.current === 0
        ? 0
        : Math.max(0, COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS - elapsed);

    const start = () => {
      refreshTimerRef.current = null;
      if (inactiveRef.current || hiddenRef.current || inFlightRef.current) return;
      if (noticeSeqRef.current <= consumedThroughRef.current) return;
      void refetchRef.current();
    };

    if (wait <= 0) {
      start();
      return;
    }
    refreshTimerRef.current = setTimeout(start, wait);
  }, []);
  scheduleRefreshRef.current = scheduleRefresh;

  const requestRefresh = useCallback(() => {
    if (inactiveRef.current) return;
    noticeSeqRef.current += 1;
    scheduleRefresh();
  }, [scheduleRefresh]);

  const reschedulePoll = useCallback(
    (mode: PollMode) => {
      clearPollTimer();
      if (inactiveRef.current || hiddenRef.current) return;
      const interval =
        (mode === 'failure' || activeOrIssuesRef.current
          ? COMPUTE_ACTIVITY_ACTIVE_POLL_INTERVAL_MS
          : COMPUTE_ACTIVITY_IDLE_POLL_INTERVAL_MS) *
        (0.9 + Math.random() * 0.2);
      const delay =
        mode === 'success' && lastSuccessAtRef.current > 0
          ? Math.max(0, lastSuccessAtRef.current + interval - Date.now())
          : interval;
      pollTimerRef.current = setTimeout(() => {
        pollTimerRef.current = null;
        if (inactiveRef.current || hiddenRef.current) return;
        requestRefresh();
      }, delay);
    },
    [requestRefresh]
  );
  reschedulePollRef.current = reschedulePoll;

  useEffect(() => {
    generationRef.current += 1;
    noticeSeqRef.current = 0;
    consumedThroughRef.current = 0;
    inFlightRef.current = false;
    lastRequestStartedAtRef.current = 0;
    lastSuccessAtRef.current = 0;
    hiddenRef.current = document.visibilityState === 'hidden';
    inactiveRef.current = !enabled;
    clearRefreshTimer();
    clearPollTimer();
    return () => {
      generationRef.current += 1;
      inactiveRef.current = true;
      inFlightRef.current = false;
      clearRefreshTimer();
      clearPollTimer();
    };
  }, [enabled, baseId, tableId]);

  const query = useQuery({
    queryKey: ['compute-activity', baseId, tableId],
    // Supplemental status failures are displayed locally by the activity panel.
    meta: { preventGlobalError: true },
    queryFn: async ({ signal }) => {
      const generation = generationRef.current;
      const coveredThrough = noticeSeqRef.current;
      inFlightRef.current = true;
      lastRequestStartedAtRef.current = Date.now();
      let succeeded = false;
      try {
        const data = await fetchComputeActivity(baseIdRef.current!, tableIdRef.current!, signal);
        if (!data) throw new Error('Compute activity unavailable');
        if (generation !== generationRef.current) return data;
        succeeded = true;
        lastSuccessAtRef.current = Date.now();
        consumedThroughRef.current = coveredThrough;
        activeOrIssuesRef.current = snapshotHasActiveOrIssues(data);
        return data;
      } finally {
        if (generation === generationRef.current) {
          inFlightRef.current = false;
          reschedulePollRef.current(succeeded ? 'success' : 'failure');
          // After React Query observes this promise, not during queryFn.
          setTimeout(() => {
            if (generation !== generationRef.current) return;
            if (noticeSeqRef.current > coveredThrough) {
              scheduleRefreshRef.current();
            }
          }, 0);
        }
      }
    },
    enabled: enabled && Boolean(baseId && tableId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: COMPUTE_ACTIVITY_REFETCH_MIN_INTERVAL_MS,
    // A failed read must retain React Query's last successful snapshot.
  });
  refetchRef.current = query.refetch;

  useEffect(() => {
    if (query.dataUpdatedAt) {
      setRevision((current) => current + 1);
    }
  }, [query.dataUpdatedAt]);

  useEffect(() => {
    if (!enabled || !query.dataUpdatedAt || !query.data) return;
    if (lastSuccessAtRef.current !== 0) return;
    lastSuccessAtRef.current = query.dataUpdatedAt;
    lastRequestStartedAtRef.current = query.dataUpdatedAt;
    activeOrIssuesRef.current = snapshotHasActiveOrIssues(query.data);
    reschedulePollRef.current('success');
  }, [enabled, query.dataUpdatedAt, query.data]);

  const onComputeActivityChanged = useCallback(() => requestRefresh(), [requestRefresh]);
  useTableListener(enabled ? tableId : undefined, computeActivityMatches, onComputeActivityChanged);

  const fieldMetaById = useMemo(
    () => (enabled ? mergeFieldMeta(query.data?.fields, tableId, readableFieldIds) : {}),
    [enabled, query.data?.fields, tableId, readableFieldIds]
  );

  // Apply onto field instances for any code reading field.isPending/computeMeta,
  // AND bump revision so memoized column themes recompute.
  useEffect(() => {
    if (!enabled || !fields?.length || (!query.data && !Object.keys(fieldMetaById).length)) return;
    let changed = false;
    for (const field of fields) {
      const meta = fieldMetaById[field.id];
      if (
        applyFieldComputeMeta(
          field as { id: string; computeMeta?: FieldComputeMetaClient; isPending?: boolean },
          meta
        )
      ) {
        changed = true;
      }
    }
    if (changed) {
      setRevision((r) => r + 1);
    }
  }, [enabled, fields, fieldMetaById, query.data]);

  // Table counts stay permission-scoped from HTTP field metas, not the global table doc.
  const tableMeta = useMemo(() => {
    if (!enabled || !query.data?.table) return undefined;
    const metas = Object.values(fieldMetaById);
    const calculatingFieldCount = metas.filter(({ status }) => status === 'running').length;
    const queuedFieldCount = metas.filter(({ status }) => status === 'queued').length;
    return {
      ...query.data.table,
      status:
        calculatingFieldCount + queuedFieldCount > 0 ? ('calculating' as const) : ('idle' as const),
      calculatingFieldCount,
      queuedFieldCount,
    };
  }, [enabled, query.data?.table, fieldMetaById]);
  const diagnostics = useMemo<ComputeActivityDiagnosticsClient | null>(() => {
    const httpDiagnostics = enabled ? query.data?.diagnostics : undefined;
    const fieldMeta = Object.values(fieldMetaById);
    if (!httpDiagnostics && fieldMeta.length === 0) return null;

    let queuedFieldCount = 0;
    let calculatingFieldCount = 0;
    let failedFieldCount = 0;
    for (const meta of fieldMeta) {
      if (meta.status === 'queued') queuedFieldCount += 1;
      if (meta.status === 'running') calculatingFieldCount += 1;
      if (meta.status === 'failed') failedFieldCount += 1;
    }

    return {
      computeMode: httpDiagnostics?.computeMode ?? 'server',
      executionState: httpDiagnostics?.executionState,
      activeFieldCount: queuedFieldCount + calculatingFieldCount,
      queuedFieldCount,
      calculatingFieldCount,
      failedFieldCount,
      highComplexityFieldCount: httpDiagnostics?.highComplexityFieldCount ?? 0,
      anomalies: httpDiagnostics?.anomalies ?? [],
      pause: httpDiagnostics?.pause,
      reliability: httpDiagnostics?.reliability,
    };
  }, [enabled, fieldMetaById, query.data?.diagnostics]);
  const activeFieldCount = diagnostics?.activeFieldCount ?? 0;

  const hasIssues =
    Object.values(fieldMetaById).some(
      (field) => field.status === 'failed' || (field.reliability?.unresolvedCount ?? 0) > 0
    ) || (diagnostics?.reliability?.unresolvedCount ?? 0) > 0;

  useEffect(() => {
    const next = activeFieldCount > 0 || hasIssues;
    const prev = activeOrIssuesRef.current;
    activeOrIssuesRef.current = next;
    if (prev !== next && enabled && baseId && tableId) {
      reschedulePoll(lastSuccessAtRef.current > 0 ? 'success' : 'failure');
    }
  }, [enabled, baseId, tableId, activeFieldCount, hasIssues, reschedulePoll]);

  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      hiddenRef.current = hidden;
      if (hidden) {
        clearRefreshTimer();
        clearPollTimer();
        return;
      }
      if (!inactiveRef.current) {
        requestRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [requestRefresh]);

  useEffect(() => {
    // useQuery already fetches on mount; only refresh after a real reconnect.
    if (enabled && connected && !previousConnection.current && seenConnected.current) {
      requestRefresh();
    }
    if (connected) {
      seenConnected.current = true;
    }
    previousConnection.current = connected;
  }, [enabled, connected, requestRefresh]);

  const refetch = useCallback(() => {
    if (!enabled) return;
    requestRefresh();
  }, [enabled, requestRefresh]);

  return {
    snapshot: enabled ? query.data ?? null : null,
    tableMeta: tableMeta ?? null,
    fieldMetaById,
    diagnostics,
    activeFieldCount,
    isFetching: enabled && query.isFetching,
    observationState: getObservationState(
      enabled,
      Boolean(
        query.isError ||
          (query.data && connection && !connected && connection.state !== 'connecting')
      ),
      Boolean(query.data),
      query.data?.observationState
    ),
    refetch,
    /** Increments when activity changes — include in useGridColumns memo deps. */
    revision,
  };
}

/**
 * Shared compute-activity state. When under {@link ComputeActivityProvider},
 * reuses the provider subscription so panel + grid columns share one revision.
 */
export function useComputeActivity(): IComputeActivityState {
  const shared = useContext(ComputeActivityContext);
  const local = useComputeActivitySubscription({ enabled: shared == null });
  return shared ?? local;
}
