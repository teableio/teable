import { useQuery } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Doc } from 'sharedb/lib/client';
import { ComputeActivityContext } from '../context/compute-activity/ComputeActivityContext';
import { FieldContext } from '../context/field/FieldContext';
import {
  applyFieldComputeMeta,
  isActiveComputeStatus,
  type FieldComputeMetaClient,
} from './apply-field-compute-meta';
import { useBaseId } from './use-base-id';
import { useConnection } from './use-connection';
import { useTableId } from './use-table-id';

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
  fieldId?: string;
  tableId?: string;
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
  fieldId: field.fieldId,
  tableId: field.tableId,
  estimatedComplexity: field.estimatedComplexity,
  estimatedDirtyRecords: field.estimatedDirtyRecords,
  ...(field.startedAt != null ? { startedAt: field.startedAt } : {}),
  ...(field.lastDurationMs != null ? { lastDurationMs: field.lastDurationMs } : {}),
  lastError: field.lastError,
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
};

export type ComputeActivitySnapshotClient = {
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
  if (!res.ok) return null;
  const body = (await res.json()) as ComputeActivityHttpResponse;
  if (!body || !('ok' in body) || !body.ok) return null;
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
  refetch: () => unknown;
  /** Increments when activity changes — include in useGridColumns memo deps. */
  revision: number;
};

const isActiveField = (meta: FieldComputeMetaClient) => isActiveComputeStatus(meta.status);

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

  if (httpActivity.generation != null && realtimeActivity.generation != null) {
    return realtimeActivity.generation >= httpActivity.generation
      ? { ...httpActivity, ...realtimeActivity }
      : httpActivity;
  }

  const httpUpdatedAt = httpActivity.updatedAt && Date.parse(httpActivity.updatedAt);
  const realtimeUpdatedAt = realtimeActivity.updatedAt && Date.parse(realtimeActivity.updatedAt);
  if (
    typeof httpUpdatedAt === 'number' &&
    Number.isFinite(httpUpdatedAt) &&
    typeof realtimeUpdatedAt === 'number' &&
    Number.isFinite(realtimeUpdatedAt)
  ) {
    return realtimeUpdatedAt >= httpUpdatedAt
      ? { ...httpActivity, ...realtimeActivity }
      : httpActivity;
  }

  return { ...httpActivity, ...realtimeActivity };
};

const hasMergedActiveFields = (
  httpFields: ComputeActivitySnapshotClient['fields'] | undefined,
  realtimeFields: Record<string, ComputeActivityFieldClient>,
  currentTableId: string | undefined,
  readableFieldIds: ReadonlySet<string>
) => {
  return Object.values(
    mergeFieldMeta(httpFields, realtimeFields, currentTableId, readableFieldIds)
  ).some(isActiveField);
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
    const merged = preferNewestActivity(map[fieldId], field);
    if (merged) map[fieldId] = merged;
  }
  return map;
};

/**
 * Internal subscription implementation. Prefer {@link useComputeActivity} which
 * reuses {@link ComputeActivityProvider} when present.
 */
export function useComputeActivitySubscription(
  options: { enabled?: boolean } = {}
): IComputeActivityState {
  const enabled = options.enabled ?? true;
  const baseId = useBaseId();
  const tableId = useTableId();
  const { connection, connected } = useConnection();
  const { fields } = useContext(FieldContext);
  const readableFieldIds = useMemo(
    () => new Set(fields.filter((field) => field.canReadFieldRecord !== false).map(({ id }) => id)),
    [fields]
  );
  const [realtimeTable, setRealtimeTable] = useState<TableComputeActivityClient | null>(null);
  const [realtimeFields, setRealtimeFields] = useState<Record<string, ComputeActivityFieldClient>>(
    {}
  );
  const [revision, setRevision] = useState(0);

  const query = useQuery({
    queryKey: ['compute-activity', baseId, tableId],
    queryFn: () => fetchComputeActivity(baseId!, tableId!),
    enabled: enabled && Boolean(baseId && tableId),
    refetchInterval: (q) =>
      enabled &&
      hasMergedActiveFields(q.state.data?.fields, realtimeFields, tableId, readableFieldIds)
        ? 1500
        : false,
  });

  useEffect(() => {
    if (!enabled || !tableId || !connection || !connected) return;

    const collection = `cmp_${tableId}`;
    const tableDoc = connection.get(collection, 'table') as Doc<TableComputeActivityClient>;
    let cancelled = false;

    const onTableOp = () => {
      if (cancelled) return;
      if (tableDoc.data) {
        setRealtimeTable({ ...tableDoc.data });
        setRevision((r) => r + 1);
      }
    };

    tableDoc.subscribe((err) => {
      if (err || cancelled) return;
      onTableOp();
      tableDoc.on('op batch', onTableOp);
      tableDoc.on('op', onTableOp);
      tableDoc.on('create', onTableOp);
    });

    return () => {
      cancelled = true;
      tableDoc.removeListener('op batch', onTableOp);
      tableDoc.removeListener('op', onTableOp);
      tableDoc.removeListener('create', onTableOp);
    };
  }, [enabled, tableId, connection, connected]);

  useEffect(() => {
    if (!enabled || !tableId || !connection || !connected || !fields?.length) return;

    const collection = `cmp_${tableId}`;
    const listeners: Array<{
      doc: Doc<ComputeActivityFieldTransport>;
      onOp: () => void;
    }> = [];
    let cancelled = false;

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
      doc.subscribe((err) => {
        if (err || cancelled) return;
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
      }
    };
  }, [enabled, tableId, connection, connected, fields]);

  const fieldMetaById = useMemo(
    () => mergeFieldMeta(query.data?.fields, realtimeFields, tableId, readableFieldIds),
    [query.data?.fields, realtimeFields, tableId, readableFieldIds]
  );

  // Apply onto field instances for any code reading field.isPending/computeMeta,
  // AND bump revision so memoized column themes recompute.
  useEffect(() => {
    if (!enabled || !fields?.length) return;
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
  }, [enabled, fields, fieldMetaById]);

  const tableMeta = preferNewestActivity(
    query.data?.table ?? undefined,
    realtimeTable ?? undefined
  );
  const diagnostics = useMemo<ComputeActivityDiagnosticsClient | null>(() => {
    const httpDiagnostics = query.data?.diagnostics;
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
      activeFieldCount: queuedFieldCount + calculatingFieldCount,
      queuedFieldCount,
      calculatingFieldCount,
      failedFieldCount,
      highComplexityFieldCount: httpDiagnostics?.highComplexityFieldCount ?? 0,
      anomalies: httpDiagnostics?.anomalies ?? [],
    };
  }, [fieldMetaById, query.data?.diagnostics]);
  const activeFieldCount = diagnostics?.activeFieldCount ?? 0;

  const refetch = useCallback(() => query.refetch(), [query]);

  return {
    snapshot: query.data ?? null,
    tableMeta: tableMeta ?? null,
    fieldMetaById,
    diagnostics,
    activeFieldCount,
    isFetching: query.isFetching,
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
