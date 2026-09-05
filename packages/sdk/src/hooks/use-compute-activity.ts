import { useQuery } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Doc } from 'sharedb/lib/client';
import type { Error as ShareDbError } from 'sharedb/lib/sharedb';
import { ComputeActivityContext } from '../context/compute-activity/ComputeActivityContext';
import { FieldContext } from '../context/field/FieldContext';
import { applyFieldComputeMeta, type FieldComputeMetaClient } from './apply-field-compute-meta';
import { useBaseId } from './use-base-id';
import { useConnection } from './use-connection';
import { useIsReadOnlyPreview } from './use-is-readonly-preview';
import { useTableId } from './use-table-id';

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

const isUncreatedDocumentError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'ERR_DOC_DOES_NOT_EXIST';
};

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
  tableId: string
): Promise<ComputeActivitySnapshotClient | null> {
  const params = new URLSearchParams({ baseId, tableId });
  const res = await fetch(`/api/v2/tables/getComputeActivity?${params.toString()}`, {
    credentials: 'include',
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
}

/** Shared compute-activity state shape (provider + hook). Explicit type avoids circular ReturnType. */
export type IComputeActivityState = {
  snapshot: ComputeActivitySnapshotClient | null;
  tableMeta: TableComputeActivityClient | null;
  fieldMetaById: Record<string, ComputeActivityFieldClient>;
  diagnostics: ComputeActivityDiagnosticsClient | null;
  activeFieldCount: number;
  isFetching: boolean;
  observationState?: 'available' | 'syncing' | 'unavailable';
  refetch: () => unknown;
  /** Increments when activity changes — include in useGridColumns memo deps. */
  revision: number;
};

type VersionedActivity = {
  generation?: number;
  updatedAt?: string;
};

const preferNewestActivity = <T extends VersionedActivity>(
  httpActivity: T | undefined,
  realtimeActivity: T | undefined
): T | undefined => {
  if (!httpActivity) return realtimeActivity;
  if (!realtimeActivity) return httpActivity;

  // Rebuilt projections restart generation counters; persisted update time spans those epochs.
  const httpUpdatedAt = httpActivity.updatedAt && Date.parse(httpActivity.updatedAt);
  const realtimeUpdatedAt = realtimeActivity.updatedAt && Date.parse(realtimeActivity.updatedAt);
  if (
    typeof httpUpdatedAt === 'number' &&
    Number.isFinite(httpUpdatedAt) &&
    typeof realtimeUpdatedAt === 'number' &&
    Number.isFinite(realtimeUpdatedAt) &&
    httpUpdatedAt !== realtimeUpdatedAt
  ) {
    return realtimeUpdatedAt >= httpUpdatedAt
      ? { ...httpActivity, ...realtimeActivity }
      : httpActivity;
  }

  if (httpActivity.generation != null && realtimeActivity.generation != null) {
    return realtimeActivity.generation > httpActivity.generation
      ? { ...httpActivity, ...realtimeActivity }
      : httpActivity;
  }

  return { ...httpActivity, ...realtimeActivity };
};

const mergeFieldActivity = (
  httpField: ComputeActivityFieldClient | undefined,
  realtimeField: ComputeActivityFieldClient
): ComputeActivityFieldClient => {
  const merged = preferNewestActivity(httpField, realtimeField)!;
  // Durable issue state does not share the resettable projection generation clock.
  const reliability = httpField ? httpField.reliability : merged.reliability;
  return {
    ...merged,
    reliability,
    status:
      (reliability?.unresolvedCount ?? 0) > 0 && merged.status === 'idle'
        ? 'failed'
        : merged.status,
  };
};

const mergeFieldMeta = (
  httpFields: ComputeActivitySnapshotClient['fields'] | undefined,
  realtimeFields: Record<string, ComputeActivityFieldClient>,
  currentTableId: string | undefined,
  readableFieldIds: ReadonlySet<string>
) => {
  const map: Record<string, ComputeActivityFieldClient> = {};
  for (const field of httpFields ?? []) {
    if (!readableFieldIds.has(field.fieldId)) continue;
    if (field.tableId && field.tableId !== currentTableId) continue;
    map[field.fieldId] = { ...field };
  }
  for (const [fieldId, field] of Object.entries(realtimeFields)) {
    if (!readableFieldIds.has(fieldId)) continue;
    map[fieldId] = mergeFieldActivity(map[fieldId], field);
  }
  return map;
};

const getObservationState = (
  enabled: boolean,
  unavailable: boolean,
  hasSnapshot: boolean,
  serverState?: IComputeActivityState['observationState']
): NonNullable<IComputeActivityState['observationState']> => {
  if (!enabled) return 'available';
  if (unavailable) return 'unavailable';
  if (serverState && serverState !== 'available') return serverState;
  return hasSnapshot ? 'available' : 'syncing';
};

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
  const [realtimeScope, setRealtimeScope] = useState(tableId);
  const [realtimeFields, setRealtimeFields] = useState<Record<string, ComputeActivityFieldClient>>(
    {}
  );
  const [revision, setRevision] = useState(0);
  const [subscriptionFailed, setSubscriptionFailed] = useState(false);
  const previousConnection = useRef(connected);

  useEffect(() => {
    setRealtimeScope(tableId);
    setRealtimeFields({});
    setSubscriptionFailed(false);
  }, [baseId, tableId]);

  const query = useQuery({
    queryKey: ['compute-activity', baseId, tableId],
    queryFn: () => fetchComputeActivity(baseId!, tableId!),
    enabled: enabled && Boolean(baseId && tableId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // A failed read must retain React Query's last successful snapshot.
  });

  useEffect(() => {
    if (!enabled || !tableId || !connection || !connected || !fields?.length) return;

    const collection = `cmp_${tableId}`;
    const listeners: Array<{
      doc: Doc<ComputeActivityFieldTransport>;
      onOp: () => void;
    }> = [];
    let cancelled = false;

    const onError = (error: ShareDbError) => {
      if (isUncreatedDocumentError(error)) return;
      setSubscriptionFailed(true);
      connection.emit('error', error);
    };

    const attach = (fieldId: string) => {
      const doc = connection.get(collection, fieldId) as Doc<ComputeActivityFieldTransport>;
      const onOp = () => {
        if (cancelled || !doc.data) return;
        setRealtimeFields((prev) => ({
          ...prev,
          [fieldId]: normalizeComputeActivityField(doc.data),
        }));
        setRevision((r) => r + 1);
      };
      listeners.push({ doc, onOp });
      doc.on('error', onError);
      doc.subscribe((err) => {
        if (cancelled) return;
        if (err) {
          if (!isUncreatedDocumentError(err)) setSubscriptionFailed(true);
          return;
        }
        onOp();
        doc.on('op batch', onOp);
        doc.on('op', onOp);
        doc.on('create', onOp);
      });
    };

    const bulkConnection = connection as typeof connection & {
      startBulk?: () => void;
      endBulk?: () => void;
    };
    bulkConnection.startBulk?.();
    try {
      for (const field of fields) {
        if (field.canReadFieldRecord !== false) attach(field.id);
      }
    } finally {
      bulkConnection.endBulk?.();
    }

    return () => {
      cancelled = true;
      for (const { doc, onOp } of listeners) {
        doc.removeListener('op', onOp);
        doc.removeListener('op batch', onOp);
        doc.removeListener('create', onOp);
        doc.removeListener('error', onError);
      }
    };
  }, [enabled, tableId, connection, connected, fields]);

  const fieldMetaById = useMemo(
    () =>
      enabled
        ? mergeFieldMeta(
            query.data?.fields,
            realtimeScope === tableId ? realtimeFields : {},
            tableId,
            readableFieldIds
          )
        : {},
    [enabled, query.data?.fields, realtimeFields, realtimeScope, tableId, readableFieldIds]
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

  // Global ShareDB table aggregates cannot be safely projected for restricted readers.
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
  const refresh = query.refetch;
  useEffect(() => {
    if (!enabled || !baseId || !tableId) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(
        () => {
          void refresh();
          schedule();
        },
        (activeFieldCount > 0 || hasIssues ? 15_000 : 60_000) * (0.9 + Math.random() * 0.2)
      );
    };
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, baseId, tableId, refresh, activeFieldCount, hasIssues]);

  useEffect(() => {
    if (enabled && connected && !previousConnection.current) {
      setSubscriptionFailed(false);
      void refresh();
    }
    previousConnection.current = connected;
  }, [enabled, connected, refresh]);

  const refetch = useCallback(() => (enabled ? query.refetch() : undefined), [enabled, query]);

  return {
    snapshot: enabled ? query.data ?? null : null,
    tableMeta: tableMeta ?? null,
    fieldMetaById,
    diagnostics,
    activeFieldCount,
    isFetching: enabled && query.isFetching,
    observationState: getObservationState(
      enabled,
      Boolean(query.isError || subscriptionFailed || (connection && !connected)),
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
