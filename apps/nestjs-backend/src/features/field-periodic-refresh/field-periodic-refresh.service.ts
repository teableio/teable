import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  analyzePeriodicRefreshSpec,
  computePeriodicRefreshRangeHash,
  getLocalDateParts,
  HttpErrorCode,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ITriggerFieldPeriodicRefreshVo,
  IUpdateFieldPeriodicRefreshRo,
  IUpdateFieldPeriodicRefreshVo,
} from '@teable/openapi';
import {
  v2RecordRepositoryPostgresTokens,
  type PeriodicFieldRefreshEngine,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  BaseId,
  FieldId,
  TableId,
  v2CoreTokens,
  type FormulaSourceBudget,
  type IExecutionContext,
  type ITracer,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { DataDbHealthService } from '../space/data-db-health.service';
import { V2ContainerService } from '../v2/v2-container.service';
import {
  buildFieldPeriodicRefreshVo,
  FieldPeriodicRefreshStateService,
  hasActiveInFlightPeriodicRefresh,
  syncFieldPeriodicRefreshMetadata,
} from './field-periodic-refresh-state.service';
import {
  defaultPeriodicRefreshEntitlementPort,
  PERIODIC_REFRESH_ENTITLEMENT_PORT,
  type IPeriodicRefreshEntitlementPort,
} from './periodic-refresh-entitlement.port';
import {
  PeriodicRefreshMetricsService,
  type PeriodicRefreshMetricMode,
  type PeriodicRefreshMetricOutcome,
} from './periodic-refresh-metrics.service';

export type PeriodicRefreshTriggerSource = 'manual' | 'scheduled' | 'lazy';

const MANUAL_REFRESH_DEDUP_TTL_SECONDS = 30;
const DEFAULT_SYNC_ROW_THRESHOLD = 2000;

const parseJsonColumn = (raw: unknown): unknown => {
  if (typeof raw !== 'string' || !raw) return raw ?? undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

@Injectable()
export class FieldPeriodicRefreshService {
  private readonly logger = new Logger(FieldPeriodicRefreshService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cacheService: CacheService,
    private readonly v2ContainerService: V2ContainerService,
    private readonly stateService: FieldPeriodicRefreshStateService,
    private readonly cls: ClsService<IClsStore>,
    @Optional() private readonly dataDbHealthService?: DataDbHealthService,
    @Optional()
    @Inject(PERIODIC_REFRESH_ENTITLEMENT_PORT)
    private readonly entitlementPort?: IPeriodicRefreshEntitlementPort,
    @Optional() private readonly metricsService?: PeriodicRefreshMetricsService
  ) {}

  async updatePeriodicRefresh(
    tableId: string,
    fieldId: string,
    ro: IUpdateFieldPeriodicRefreshRo
  ): Promise<IUpdateFieldPeriodicRefreshVo> {
    const { baseId, spaceId, spec } = await this.loadFieldContextOrThrow(tableId, fieldId);
    if (!spec.supported) {
      this.metricsService?.recordConfigUpdate(ro.enabled, 'unsupported');
      throw new CustomHttpException(
        'Field does not use relative date filters or volatile time functions',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    if (ro.enabled) {
      await this.assertAutoRefreshAllowedWithMetrics(spaceId);
    }

    await syncFieldPeriodicRefreshMetadata(this.prismaService.txClient(), fieldId);
    const updatedState = await this.stateService.setEnabledState({
      fieldId,
      tableId,
      baseId,
      enabled: ro.enabled,
      timeZone: spec.timeZone,
      containsNowPrecision: spec.containsNowPrecision,
    });
    this.metricsService?.recordConfigUpdate(ro.enabled, 'ok');

    return {
      fieldId,
      periodicRefresh: buildFieldPeriodicRefreshVo(spec, updatedState),
    };
  }

  async triggerRefresh(params: {
    tableId: string;
    fieldId: string;
    trigger: PeriodicRefreshTriggerSource;
    force?: boolean;
    now?: Date;
    actorId?: string;
    syncRowThreshold?: number;
  }): Promise<ITriggerFieldPeriodicRefreshVo> {
    const startedAtMs = Date.now();
    const now = params.now ?? new Date();
    const context = await this.loadFieldContextOrThrow(params.tableId, params.fieldId);

    if (!context.spec.supported) {
      this.recordRunMetric(params.trigger, startedAtMs, 'unsupported', 'none');
      if (params.trigger === 'manual') {
        throw new CustomHttpException(
          'Field does not use relative date filters or volatile time functions',
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      return this.buildSkippedResult('skipped_unchanged', context, context.existingState);
    }

    // Automatic work may have been selected before the field was disabled.
    if (params.trigger !== 'manual' && !context.existingState?.enabled) {
      this.recordRunMetric(params.trigger, startedAtMs, 'skipped_unchanged', 'none');
      return this.buildSkippedResult('skipped_unchanged', context, context.existingState);
    }

    const supportedContext = {
      ...context,
      spec: context.spec,
    };

    const unhealthyResult = await this.checkDbHealthOrSkip(supportedContext);
    if (unhealthyResult) {
      this.recordRunMetric(params.trigger, startedAtMs, 'skipped_db_unhealthy', 'none');
      return unhealthyResult;
    }

    const rangeHashInfo = computePeriodicRefreshRangeHash(supportedContext.fieldInput, now);
    const rangeHash = rangeHashInfo?.rangeHash ?? '';
    if (this.shouldShortCircuitByRangeHash(params, supportedContext, rangeHash)) {
      this.recordRunMetric(params.trigger, startedAtMs, 'skipped_unchanged', 'none');
      return this.buildSkippedResult(
        'skipped_unchanged',
        supportedContext,
        supportedContext.existingState
      );
    }

    if (
      params.trigger !== 'manual' &&
      !params.force &&
      hasActiveInFlightPeriodicRefresh(
        supportedContext.existingState,
        rangeHash,
        supportedContext.spec.containsNowPrecision,
        now
      )
    ) {
      this.recordRunMetric(params.trigger, startedAtMs, 'deduped', 'none');
      return {
        status: 'queued',
        mode: 'async',
        taskId: supportedContext.existingState?.pendingTaskId ?? null,
        refreshedAt: supportedContext.existingState?.lastRefreshedAt?.toISOString() ?? null,
        periodicRefresh: buildFieldPeriodicRefreshVo(
          supportedContext.spec,
          supportedContext.existingState
        ),
      };
    }

    if (params.trigger === 'manual') {
      const deduped = await this.acquireManualDedupOrReturn(supportedContext, now);
      if (deduped) {
        this.recordRunMetric(params.trigger, startedAtMs, 'deduped', 'none');
        return deduped;
      }
    }

    return this.executeEngineRefresh({
      context: supportedContext,
      trigger: params.trigger,
      actorId: params.actorId,
      syncRowThreshold: params.syncRowThreshold,
      startedAtMs,
      now,
      rangeHash,
      localDate: rangeHashInfo?.localDate,
    });
  }

  private async assertAutoRefreshAllowedWithMetrics(spaceId: string): Promise<void> {
    const entitlement = this.entitlementPort ?? defaultPeriodicRefreshEntitlementPort;
    try {
      await entitlement.assertAutoRefreshAllowed(spaceId);
    } catch (error) {
      this.metricsService?.recordConfigUpdate(true, 'denied');
      throw error;
    }
  }

  private recordRunMetric(
    trigger: PeriodicRefreshTriggerSource,
    startedAtMs: number,
    outcome: PeriodicRefreshMetricOutcome,
    mode: PeriodicRefreshMetricMode
  ): void {
    this.metricsService?.recordRun({
      trigger,
      outcome,
      mode,
      durationMs: Date.now() - startedAtMs,
    });
  }

  private buildSkippedResult(
    status: 'skipped_unchanged' | 'skipped_db_unhealthy' | 'deduped',
    context: Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>,
    state: Parameters<typeof buildFieldPeriodicRefreshVo>[1]
  ): ITriggerFieldPeriodicRefreshVo {
    return {
      status,
      mode: 'none',
      taskId: null,
      refreshedAt: state?.lastRefreshedAt?.toISOString() ?? null,
      periodicRefresh: buildFieldPeriodicRefreshVo(context.spec, state),
    };
  }

  private async checkDbHealthOrSkip(
    context: Omit<
      Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>,
      'spec'
    > & {
      spec: Extract<
        Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>['spec'],
        { supported: true }
      >;
    }
  ): Promise<ITriggerFieldPeriodicRefreshVo | null> {
    if (!this.dataDbHealthService) {
      return null;
    }
    const health = await this.dataDbHealthService.getHealthStateForBase(context.baseId);
    if (health !== 'unreachable' && health !== 'read_only') {
      return null;
    }
    const updatedState = await this.stateService.recordSkippedDbUnhealthy({
      fieldId: context.fieldId,
      tableId: context.tableId,
      baseId: context.baseId,
      timeZone: context.spec.timeZone,
      containsNowPrecision: context.spec.containsNowPrecision,
      message: `Tenant database is ${health}`,
    });
    return this.buildSkippedResult('skipped_db_unhealthy', context, updatedState);
  }

  private shouldShortCircuitByRangeHash(
    params: { trigger: PeriodicRefreshTriggerSource; force?: boolean },
    context: Omit<
      Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>,
      'spec'
    > & {
      spec: Extract<
        Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>['spec'],
        { supported: true }
      >;
    },
    rangeHash: string
  ): boolean {
    return Boolean(
      params.trigger !== 'manual' &&
      !params.force &&
      !context.spec.containsNowPrecision &&
      rangeHash &&
      context.existingState?.lastRangeHash &&
      context.existingState.lastRangeHash === rangeHash
    );
  }

  private async acquireManualDedupOrReturn(
    context: Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>,
    now: Date
  ): Promise<ITriggerFieldPeriodicRefreshVo | null> {
    const dedupKey = `periodic-refresh:manual-dedup:${context.fieldId}` as const;
    const acquired = await this.cacheService.setnx(
      dedupKey,
      now.toISOString(),
      MANUAL_REFRESH_DEDUP_TTL_SECONDS
    );
    return acquired ? null : this.buildSkippedResult('deduped', context, context.existingState);
  }

  private async executeEngineRefresh(params: {
    context: Omit<
      Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>,
      'spec'
    > & {
      spec: Extract<
        Awaited<ReturnType<FieldPeriodicRefreshService['loadFieldContextOrThrow']>>['spec'],
        { supported: true }
      >;
    };
    trigger: PeriodicRefreshTriggerSource;
    actorId?: string;
    syncRowThreshold?: number;
    startedAtMs: number;
    now: Date;
    rangeHash: string;
    localDate?: string;
  }): Promise<ITriggerFieldPeriodicRefreshVo> {
    const { context, now, rangeHash } = params;
    const container = await this.v2ContainerService.getContainerForBase(context.baseId);
    const engine = container.resolve<PeriodicFieldRefreshEngine>(
      v2RecordRepositoryPostgresTokens.periodicFieldRefreshEngine
    );
    const execContext = this.buildExecutionContext(container, context.fieldId, params.actorId);

    const baseIdDomain = BaseId.create(context.baseId);
    const tableIdDomain = TableId.create(context.tableId);
    const fieldIdDomain = FieldId.create(context.fieldId);
    if (baseIdDomain.isErr() || tableIdDomain.isErr() || fieldIdDomain.isErr()) {
      this.recordRunMetric(params.trigger, params.startedAtMs, 'failed', 'none');
      throw new CustomHttpException(
        'Invalid base/table/field identifier',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const localDate = params.localDate ?? getLocalDateParts(now, context.spec.timeZone).localDate;
    const result = await engine.refreshField(execContext, {
      baseId: baseIdDomain.value,
      tableId: tableIdDomain.value,
      fieldId: fieldIdDomain.value,
      syncRowThreshold: params.syncRowThreshold ?? DEFAULT_SYNC_ROW_THRESHOLD,
      periodicRefreshMeta: {
        sourceFieldId: context.fieldId,
        sourceTableId: context.tableId,
        rangeHash,
        localDate,
        timeZone: context.spec.timeZone,
        containsNowPrecision: context.spec.containsNowPrecision,
        triggeredAtIso: now.toISOString(),
      },
    });

    if (result.isErr()) {
      await this.stateService.recordFailure({
        fieldId: context.fieldId,
        tableId: context.tableId,
        baseId: context.baseId,
        timeZone: context.spec.timeZone,
        containsNowPrecision: context.spec.containsNowPrecision,
        message: result.error.message,
      });
      this.recordRunMetric(params.trigger, params.startedAtMs, 'failed', 'none');
      this.logger.warn(
        `Periodic refresh failed for field=${context.fieldId}: ${result.error.message}`
      );
      if (params.trigger === 'manual') {
        throw new CustomHttpException(result.error.message, HttpErrorCode.INTERNAL_SERVER_ERROR);
      }
      throw new Error(result.error.message);
    }

    const outcome = result.value;
    if (outcome.mode === 'async') {
      const savedState = await this.stateService.recordQueued({
        fieldId: context.fieldId,
        tableId: context.tableId,
        baseId: context.baseId,
        timeZone: context.spec.timeZone,
        containsNowPrecision: context.spec.containsNowPrecision,
        taskId: outcome.taskId ?? null,
        localDate,
        rangeHash,
        startedAt: now,
      });
      this.recordRunMetric(params.trigger, params.startedAtMs, 'queued', outcome.mode);
      return {
        status: 'queued',
        mode: outcome.mode,
        taskId: outcome.taskId ?? null,
        refreshedAt: savedState.lastRefreshedAt?.toISOString() ?? null,
        periodicRefresh: buildFieldPeriodicRefreshVo(context.spec, savedState),
      };
    }

    const savedState = await this.stateService.recordSuccess({
      fieldId: context.fieldId,
      tableId: context.tableId,
      baseId: context.baseId,
      timeZone: context.spec.timeZone,
      containsNowPrecision: context.spec.containsNowPrecision,
      refreshedAt: now,
      localDate,
      rangeHash,
    });

    this.recordRunMetric(params.trigger, params.startedAtMs, 'refreshed', outcome.mode);

    return {
      status: 'refreshed',
      mode: outcome.mode,
      taskId: outcome.taskId ?? null,
      refreshedAt: now.toISOString(),
      periodicRefresh: buildFieldPeriodicRefreshVo(context.spec, savedState),
    };
  }

  private async loadFieldContextOrThrow(tableId: string, fieldId: string) {
    const field = await this.prismaService.txClient().field.findFirst({
      where: { id: fieldId, tableId, deletedTime: null },
      select: {
        id: true,
        tableId: true,
        type: true,
        options: true,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: true,
        periodicRefreshState: true,
        table: {
          select: {
            baseId: true,
            base: {
              select: {
                spaceId: true,
              },
            },
          },
        },
      },
    });
    if (!field) {
      throw new NotFoundException(`Field ${fieldId} not found in table ${tableId}`);
    }

    const fieldInput = {
      type: field.type,
      options: parseJsonColumn(field.options),
      isLookup: field.isLookup ?? false,
      isConditionalLookup: field.isConditionalLookup ?? false,
      lookupOptions: parseJsonColumn(field.lookupOptions),
    };
    const spec = analyzePeriodicRefreshSpec(fieldInput);

    return {
      fieldId: field.id,
      tableId: field.tableId,
      baseId: field.table.baseId,
      spaceId: field.table.base.spaceId,
      fieldInput,
      spec,
      existingState: field.periodicRefreshState,
    };
  }

  private buildExecutionContext(
    container: Awaited<ReturnType<V2ContainerService['getContainerForBase']>>,
    fieldId: string,
    explicitActorId?: string
  ): IExecutionContext {
    const rawActorId = explicitActorId ?? this.cls.get('user.id') ?? 'system';
    const actorIdResult = ActorId.create(rawActorId);
    const actorId = actorIdResult.isOk()
      ? actorIdResult.value
      : ActorId.create('system')._unsafeUnwrap();
    const tracer = container.isRegistered(v2CoreTokens.tracer)
      ? container.resolve<ITracer>(v2CoreTokens.tracer)
      : undefined;
    const formulaSourceBudget = container.isRegistered(v2CoreTokens.formulaSourceBudget)
      ? container.resolve<FormulaSourceBudget>(v2CoreTokens.formulaSourceBudget)
      : undefined;

    return {
      actorId,
      tracer,
      requestId: this.cls.getId() || `periodic-refresh:${fieldId}`,
      ...(formulaSourceBudget ? { config: { formulaSourceBudget } } : {}),
    };
  }
}
