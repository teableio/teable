import { Injectable } from '@nestjs/common';
import type {
  IFieldPeriodicRefreshVo,
  IFieldVo,
  IPeriodicRefreshSpec,
  PeriodicRefreshStatus,
} from '@teable/core';
import { analyzePeriodicRefreshSpec } from '@teable/core';
import { PrismaService, type Prisma } from '@teable/db-main-prisma';

export type FieldPeriodicRefreshStateRecord = {
  fieldId: string;
  tableId: string;
  baseId: string;
  enabled: boolean;
  timeZone: string;
  containsNowPrecision: boolean;
  lastRefreshedAt: Date | null;
  lastRefreshedLocalDate: string | null;
  lastRangeHash: string | null;
  lastStatus: string;
  lastError: string | null;
  pendingTaskId: string | null;
  pendingLocalDate: string | null;
  pendingRangeHash: string | null;
  pendingStartedAt: Date | null;
};

const IN_FLIGHT_STALE_MS = 30 * 60 * 1000;
const IN_FLIGHT_NOW_STALE_MS = 14 * 60 * 1000;

export const hasActiveInFlightPeriodicRefresh = (
  state:
    | Pick<FieldPeriodicRefreshStateRecord, 'lastStatus' | 'pendingRangeHash' | 'pendingStartedAt'>
    | null
    | undefined,
  rangeHash: string,
  containsNowPrecision: boolean,
  now: Date
): boolean => {
  if (!state || (state.lastStatus !== 'queued' && state.lastStatus !== 'running')) {
    return false;
  }
  if (!state.pendingStartedAt) {
    return false;
  }
  const staleMs = containsNowPrecision ? IN_FLIGHT_NOW_STALE_MS : IN_FLIGHT_STALE_MS;
  if (now.getTime() - state.pendingStartedAt.getTime() >= staleMs) {
    return false;
  }
  if (containsNowPrecision) {
    return true;
  }
  return Boolean(rangeHash && state.pendingRangeHash === rangeHash);
};

const VALID_STATUSES: ReadonlySet<string> = new Set<PeriodicRefreshStatus>([
  'idle',
  'queued',
  'running',
  'completed',
  'skipped_unchanged',
  'paused_plan_downgrade',
  'skipped_db_unhealthy',
  'failed',
]);

const normalizeStatus = (raw: string | null | undefined): PeriodicRefreshStatus =>
  raw && VALID_STATUSES.has(raw) ? (raw as PeriodicRefreshStatus) : 'idle';

const parseJsonColumn = (raw: unknown): unknown => {
  if (typeof raw !== 'string' || !raw) return raw ?? undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

export const buildFieldPeriodicRefreshVo = (
  spec: IPeriodicRefreshSpec,
  state?: Pick<
    FieldPeriodicRefreshStateRecord,
    'enabled' | 'lastStatus' | 'lastRefreshedAt' | 'lastRefreshedLocalDate'
  > | null
): IFieldPeriodicRefreshVo => {
  if (!spec.supported) {
    return {
      supported: false,
      enabled: false,
      cadence: 'day',
      timeZone: 'UTC',
      lastStatus: 'idle',
    };
  }

  return {
    supported: true,
    enabled: state?.enabled ?? false,
    cadence: spec.cadence,
    timeZone: spec.timeZone,
    containsNowPrecision: spec.containsNowPrecision,
    lastRefreshedAt: state?.lastRefreshedAt ? state.lastRefreshedAt.toISOString() : null,
    lastRefreshedLocalDate: state?.lastRefreshedLocalDate ?? null,
    lastStatus: normalizeStatus(state?.lastStatus),
  };
};

/**
 * Projects static refresh eligibility (`needsPeriodicRefresh`, `refreshCadence`) onto `field`
 * strictly during field schema lifecycle events, without ever bumping `field.version`.
 */
export const syncFieldPeriodicRefreshMetadata = async (
  prisma: Prisma.TransactionClient,
  fieldId: string
): Promise<IPeriodicRefreshSpec | undefined> => {
  const row = await prisma.field.findFirst({
    where: { id: fieldId, deletedTime: null },
    select: {
      id: true,
      type: true,
      options: true,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: true,
      needsPeriodicRefresh: true,
      refreshCadence: true,
    },
  });
  if (!row) return undefined;

  const spec = analyzePeriodicRefreshSpec({
    type: row.type,
    options: parseJsonColumn(row.options),
    isLookup: row.isLookup ?? false,
    isConditionalLookup: row.isConditionalLookup ?? false,
    lookupOptions: parseJsonColumn(row.lookupOptions),
  });

  const nextNeeds = spec.supported;
  const nextCadence = spec.supported ? spec.cadence : null;

  if (row.needsPeriodicRefresh !== nextNeeds || row.refreshCadence !== nextCadence) {
    await prisma.field.updateMany({
      where: { id: fieldId },
      data: {
        needsPeriodicRefresh: nextNeeds,
        refreshCadence: nextCadence,
      },
    });
  }

  if (!spec.supported) {
    await prisma.fieldPeriodicRefreshState.updateMany({
      where: {
        fieldId,
        OR: [{ enabled: true }, { lastStatus: { not: 'idle' } }, { pendingTaskId: { not: null } }],
      },
      data: {
        enabled: false,
        lastStatus: 'idle',
        lastError: null,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
    });
  }

  return spec;
};

@Injectable()
export class FieldPeriodicRefreshStateService {
  constructor(private readonly prismaService: PrismaService) {}

  async syncFieldMetadata(fieldId: string): Promise<IPeriodicRefreshSpec | undefined> {
    return syncFieldPeriodicRefreshMetadata(this.prismaService.txClient(), fieldId);
  }

  async syncFieldsMetadata(fieldIds: ReadonlyArray<string>): Promise<void> {
    const uniqueIds = [...new Set(fieldIds.filter(Boolean))];
    for (const fieldId of uniqueIds) {
      await this.syncFieldMetadata(fieldId);
    }
  }

  async attachPeriodicRefreshToFieldVos<T extends IFieldVo>(fields: T[]): Promise<T[]> {
    if (fields.length === 0) return fields;

    const specsById = new Map<string, IPeriodicRefreshSpec>();
    const supportedIds: string[] = [];

    for (const field of fields) {
      const spec = analyzePeriodicRefreshSpec({
        type: field.type,
        options: field.options,
        isLookup: field.isLookup,
        isConditionalLookup: field.isConditionalLookup,
        lookupOptions: field.lookupOptions,
      });
      if (spec.supported) {
        specsById.set(field.id, spec);
        supportedIds.push(field.id);
      }
    }

    if (supportedIds.length === 0) {
      return fields;
    }

    const states = await this.prismaService.txClient().fieldPeriodicRefreshState.findMany({
      where: { fieldId: { in: supportedIds } },
    });
    const stateByFieldId = new Map(states.map((s) => [s.fieldId, s]));

    for (const field of fields) {
      const spec = specsById.get(field.id);
      if (!spec) continue;
      field.periodicRefresh = buildFieldPeriodicRefreshVo(spec, stateByFieldId.get(field.id));
    }

    return fields;
  }

  async setEnabledState(params: {
    fieldId: string;
    tableId: string;
    baseId: string;
    enabled: boolean;
    timeZone: string;
    containsNowPrecision: boolean;
  }): Promise<FieldPeriodicRefreshStateRecord> {
    return this.prismaService.txClient().fieldPeriodicRefreshState.upsert({
      where: { fieldId: params.fieldId },
      create: {
        fieldId: params.fieldId,
        tableId: params.tableId,
        baseId: params.baseId,
        enabled: params.enabled,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'idle',
        lastError: null,
      },
      update: {
        enabled: params.enabled,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'idle',
        lastError: null,
      },
    });
  }

  async recordSuccess(params: {
    fieldId: string;
    tableId: string;
    baseId: string;
    timeZone: string;
    containsNowPrecision: boolean;
    refreshedAt: Date;
    localDate: string;
    rangeHash: string;
  }): Promise<FieldPeriodicRefreshStateRecord> {
    return this.prismaService.txClient().fieldPeriodicRefreshState.upsert({
      where: { fieldId: params.fieldId },
      create: {
        fieldId: params.fieldId,
        tableId: params.tableId,
        baseId: params.baseId,
        enabled: false,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'completed',
        lastRefreshedAt: params.refreshedAt,
        lastRefreshedLocalDate: params.localDate,
        lastRangeHash: params.rangeHash,
        lastError: null,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
      update: {
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'completed',
        lastRefreshedAt: params.refreshedAt,
        lastRefreshedLocalDate: params.localDate,
        lastRangeHash: params.rangeHash,
        lastError: null,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
    });
  }

  /**
   * Records an enqueued async periodic-refresh stage chain without advancing
   * `lastRefreshedAt`, `lastRefreshedLocalDate`, or `lastRangeHash`. Only final
   * stage commit in the worker advances the succeeded watermarks.
   */
  async recordQueued(params: {
    fieldId: string;
    tableId: string;
    baseId: string;
    timeZone: string;
    containsNowPrecision: boolean;
    taskId: string | null;
    localDate: string;
    rangeHash: string;
    startedAt: Date;
  }): Promise<FieldPeriodicRefreshStateRecord> {
    return this.prismaService.txClient().fieldPeriodicRefreshState.upsert({
      where: { fieldId: params.fieldId },
      create: {
        fieldId: params.fieldId,
        tableId: params.tableId,
        baseId: params.baseId,
        enabled: false,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'queued',
        lastRefreshedAt: null,
        lastRefreshedLocalDate: null,
        lastRangeHash: null,
        lastError: null,
        pendingTaskId: params.taskId,
        pendingLocalDate: params.localDate,
        pendingRangeHash: params.rangeHash,
        pendingStartedAt: params.startedAt,
      },
      update: {
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'queued',
        lastError: null,
        pendingTaskId: params.taskId,
        pendingLocalDate: params.localDate,
        pendingRangeHash: params.rangeHash,
        pendingStartedAt: params.startedAt,
      },
    });
  }

  /**
   * Called from ComputedUpdateWorker after the final downstream stage commits.
   * Uses the root Prisma client because outbox workers execute outside request CLS.
   */
  async recordAsyncCompleted(params: {
    fieldId: string;
    tableId: string;
    baseId: string;
    timeZone: string;
    containsNowPrecision: boolean;
    completedAt: Date;
    triggeredAt: Date;
    localDate: string;
    rangeHash: string;
  }): Promise<FieldPeriodicRefreshStateRecord> {
    const existing = await this.prismaService.fieldPeriodicRefreshState.findUnique({
      where: { fieldId: params.fieldId },
    });
    if (
      existing?.lastRefreshedAt &&
      existing.lastRefreshedAt > params.triggeredAt &&
      existing.pendingRangeHash !== params.rangeHash
    ) {
      return existing;
    }

    return this.prismaService.fieldPeriodicRefreshState.upsert({
      where: { fieldId: params.fieldId },
      create: {
        fieldId: params.fieldId,
        tableId: params.tableId,
        baseId: params.baseId,
        enabled: false,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'completed',
        lastRefreshedAt: params.completedAt,
        lastRefreshedLocalDate: params.localDate,
        lastRangeHash: params.rangeHash,
        lastError: null,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
      update: {
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'completed',
        lastRefreshedAt: params.completedAt,
        lastRefreshedLocalDate: params.localDate,
        lastRangeHash: params.rangeHash,
        lastError: null,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
    });
  }

  /**
   * Called from ComputedUpdateWorker when any stage terminates in failure.
   * Clears in-flight markers and leaves `lastRefreshedAt`/`lastRefreshedLocalDate`/`lastRangeHash`
   * untouched so scheduled ticks and lazy catchup retry the uncompleted range.
   */
  async recordAsyncFailed(params: {
    fieldId: string;
    rangeHash: string;
    taskId: string;
    message: string;
  }): Promise<void> {
    await this.prismaService.fieldPeriodicRefreshState.updateMany({
      where: {
        fieldId: params.fieldId,
        lastStatus: { in: ['queued', 'running'] },
        OR: [
          { pendingRangeHash: params.rangeHash },
          { pendingTaskId: params.taskId },
          { pendingRangeHash: null },
        ],
      },
      data: {
        lastStatus: 'failed',
        lastError: params.message.slice(0, 500),
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
    });
  }

  async recordFailure(params: {
    fieldId: string;
    tableId: string;
    baseId: string;
    timeZone: string;
    containsNowPrecision: boolean;
    message: string;
  }): Promise<FieldPeriodicRefreshStateRecord> {
    const truncated = params.message.slice(0, 500);
    return this.prismaService.txClient().fieldPeriodicRefreshState.upsert({
      where: { fieldId: params.fieldId },
      create: {
        fieldId: params.fieldId,
        tableId: params.tableId,
        baseId: params.baseId,
        enabled: false,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'failed',
        lastError: truncated,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
      update: {
        lastStatus: 'failed',
        lastError: truncated,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
    });
  }

  async recordSkippedDbUnhealthy(params: {
    fieldId: string;
    tableId: string;
    baseId: string;
    timeZone: string;
    containsNowPrecision: boolean;
    message: string;
  }): Promise<FieldPeriodicRefreshStateRecord> {
    const truncated = params.message.slice(0, 500);
    return this.prismaService.txClient().fieldPeriodicRefreshState.upsert({
      where: { fieldId: params.fieldId },
      create: {
        fieldId: params.fieldId,
        tableId: params.tableId,
        baseId: params.baseId,
        enabled: false,
        timeZone: params.timeZone,
        containsNowPrecision: params.containsNowPrecision,
        lastStatus: 'skipped_db_unhealthy',
        lastError: truncated,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
      update: {
        lastStatus: 'skipped_db_unhealthy',
        lastError: truncated,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      },
    });
  }

  async markPausedPlanDowngrade(fieldIds: ReadonlyArray<string>): Promise<void> {
    const uniqueIds = [...new Set(fieldIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    await this.prismaService.txClient().fieldPeriodicRefreshState.updateMany({
      where: {
        fieldId: { in: uniqueIds },
        enabled: true,
        lastStatus: { not: 'paused_plan_downgrade' },
      },
      data: {
        // Deliberately preserves enabled=true so re-upgrading resumes automatically.
        lastStatus: 'paused_plan_downgrade',
        lastError: null,
      },
    });
  }

  async clearPausedPlanDowngrade(
    pausedStates: ReadonlyArray<{ fieldId: string; lastModifiedTime: Date | null }>
  ): Promise<void> {
    if (pausedStates.length === 0) return;
    await this.prismaService.txClient().fieldPeriodicRefreshState.updateMany({
      where: {
        enabled: true,
        lastStatus: 'paused_plan_downgrade',
        // A newer pause or concurrent state change supersedes this snapshot.
        OR: pausedStates.map(({ fieldId, lastModifiedTime }) => ({ fieldId, lastModifiedTime })),
      },
      data: {
        lastStatus: 'idle',
        lastError: null,
      },
    });
  }
}
