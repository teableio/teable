import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  createComputedOutboxWakeup,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
  type IComputedUpdateOutbox,
  type OutboxTaskClaimEligibility,
} from '@teable/v2-adapter-table-repository-postgres';
import { v2CoreTokens, type ITracer } from '@teable/v2-core';

import {
  DataDbBaseNotFoundError,
  DataDbBindingNotReadyError,
} from '../../../global/data-db-client-manager.service';
import { DataDbHealthService } from '../../space/data-db-health.service';
import { V2ContainerService } from '../v2-container.service';
import { OpenTelemetryTracer } from '../v2-tracer.adapter';
import {
  ComputedOutboxBaseAdmissionService,
  type ComputedOutboxBaseAdmissionPermit,
} from './computed-outbox-base-admission.service';

import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import {
  isJobAlreadyExistsError,
  isUnhealthyByodbSentinel,
  nextUnhealthyByodbDefer,
} from './computed-outbox-unhealthy-backoff';
import { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import type { ComputedOutboxWakeupWire } from './computed-outbox-wakeup.wire';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER } from './constants';

/** Handler-local tracer for wake-up spans + W3C carrier restore (no container needed). */
const wakeupTracer = new OpenTelemetryTracer('computed-outbox-wakeup');

export type ComputedOutboxWakeupHandlerOutcome = {
  status: 'processed' | 'noop' | 'deferred' | 'parked';
};

/**
 * Retry when the base concurrency/advisory slot is busy or a claim races a transaction.
 * Keep this short: a successful worker now drains the remaining queue immediately
 * (see drainRemainingOutbox), so long concurrency sleeps only add dual-link lag
 * when that drain races another claim miss. Pause still uses deterministic resume.
 */
const TRANSIENT_DEFER_DELAY_MS = 100;
/** Conservative retry for blockers without a deterministic release time. */
const BLOCKED_DEFER_DELAY_MS = 30_000;
/** Bounded stable spread keeps a hot base from retrying every rejected wake-up in lockstep. */
const ADMISSION_DEFER_MIN_MS = 500;
const ADMISSION_DEFER_SPREAD_MS = 1001;
/** Per claimBatch size while continuing after a targeted wake-up. */
const POST_PROCESS_DRAIN_BATCH_SIZE = 50;
/** Hard cap so a pathological queue cannot pin one consumer forever. */
const POST_PROCESS_DRAIN_MAX_TASKS = 500;

const createDeferredWakeupId = (taskId: string, availableAt: Date, bucketMs?: number): string =>
  `cuwd-${taskId}-${
    bucketMs ? Math.floor(availableAt.getTime() / bucketMs) : availableAt.getTime()
  }`;

const stableAdmissionDeferDelayMs = (baseId: string, taskId: string): number => {
  let hash = 2166136261;
  for (const char of `${baseId}:${taskId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ADMISSION_DEFER_MIN_MS + ((hash >>> 0) % ADMISSION_DEFER_SPREAD_MS);
};

const describeUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
};

/** Worker errors surface as Error instances or DomainError-shaped plain objects. */
const isLedgerReadOnlyError = (error: unknown): boolean =>
  /in a read-only transaction/i.test(describeUnknownError(error));

const isIndefinitelyPaused = (eligibility: OutboxTaskClaimEligibility): boolean =>
  eligibility.status === 'deferred' &&
  eligibility.reason === 'paused' &&
  eligibility.retryAt === null;

const resolveDeferredWakeup = (
  taskId: string,
  currentWakeupId: string,
  eligibility: Exclude<OutboxTaskClaimEligibility, { status: 'terminal' }>,
  nowMs: number
): { wakeupId: string; availableAt: Date } => {
  const transientRetryAt = new Date(nowMs + TRANSIENT_DEFER_DELAY_MS);
  let availableAt: Date;
  let bucketMs: number | undefined;

  if (eligibility.status === 'eligible') {
    // claimById can miss a row locked by a transaction that commits immediately afterwards.
    availableAt = transientRetryAt;
    bucketMs = TRANSIENT_DEFER_DELAY_MS;
  } else {
    const { reason, retryAt } = eligibility;
    switch (reason) {
      case 'concurrency':
        // retryAt is the processing lease expiry, not the expected blocker completion time.
        // The active worker drains siblings after it commits, so only use a short safety retry.
        availableAt = transientRetryAt;
        bucketMs = TRANSIENT_DEFER_DELAY_MS;
        break;
      case 'not_due':
        // releaseForRetry already chose the safe retry instant (250ms for computed lock misses).
        // Do not inflate it to the old generic two-second claim-race delay.
        availableAt = retryAt && retryAt.getTime() > nowMs ? retryAt : transientRetryAt;
        break;
      case 'active_lease':
        availableAt = new Date(
          Math.max(transientRetryAt.getTime(), retryAt?.getTime() ?? Number.NEGATIVE_INFINITY)
        );
        break;
      case 'paused':
        availableAt = retryAt ?? new Date(nowMs + BLOCKED_DEFER_DELAY_MS);
        break;
    }
  }

  const baseWakeupId = createDeferredWakeupId(taskId, availableAt, bucketMs);
  if (currentWakeupId === baseWakeupId || currentWakeupId.startsWith(`${baseWakeupId}-r`)) {
    availableAt = new Date(Math.max(availableAt.getTime(), nowMs + TRANSIENT_DEFER_DELAY_MS));
    return {
      availableAt,
      wakeupId: `${baseWakeupId}-r${Math.floor(availableAt.getTime() / TRANSIENT_DEFER_DELAY_MS)}`,
    };
  }
  return {
    availableAt,
    wakeupId: baseWakeupId,
  };
};

@Injectable()
export class ComputedOutboxWakeupHandler {
  private readonly logger = new Logger(ComputedOutboxWakeupHandler.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly metrics: ComputedOutboxTriggerMetrics,
    @Inject(COMPUTED_OUTBOX_WAKEUP_PUBLISHER)
    private readonly wakeupPublisher: IComputedOutboxWakeupAppPublisher,
    private readonly baseAdmission: ComputedOutboxBaseAdmissionService,
    @Optional() private readonly dataDbHealth?: DataDbHealthService
  ) {}

  async handle(wakeup: ComputedOutboxWakeupWire): Promise<ComputedOutboxWakeupHandlerOutcome> {
    return this.wakeupPublisher.runAsConsumer(() => this.handleAsConsumer(wakeup));
  }

  private async handleAsConsumer(
    wakeup: ComputedOutboxWakeupWire
  ): Promise<ComputedOutboxWakeupHandlerOutcome> {
    const carrier =
      wakeup.traceparent != null
        ? {
            traceparent: wakeup.traceparent,
            ...(wakeup.tracestate ? { tracestate: wakeup.tracestate } : {}),
          }
        : undefined;

    const run = () => this.handleWithSpans(wakeup);
    if (carrier) {
      return wakeupTracer.runWithPropagationCarrier(carrier, run);
    }
    return run();
  }

  private async handleWithSpans(
    wakeup: ComputedOutboxWakeupWire
  ): Promise<ComputedOutboxWakeupHandlerOutcome> {
    const startedAt = performance.now();
    const availableAtMs = new Date(wakeup.availableAt).getTime();
    const emittedAtMs = new Date(wakeup.emittedAt).getTime();
    const nowMs = Date.now();
    const deliveryLagMs = Math.max(0, nowMs - availableAtMs);
    const enqueueToConsumeMs = Number.isFinite(emittedAtMs)
      ? Math.max(0, nowMs - emittedAtMs)
      : undefined;

    this.metrics.recordDeliveryLag(deliveryLagMs);

    const rootSpan = wakeupTracer.startSpan('teable.computed.outbox.wakeup.handle', {
      'outbox.taskId': wakeup.taskId,
      'outbox.baseId': wakeup.baseId,
      'outbox.wakeupId': wakeup.wakeupId,
      'outbox.wakeupCause': wakeup.cause,
      'outbox.hasTraceparent': Boolean(wakeup.traceparent),
      'outbox.deliveryLagMs': deliveryLagMs,
      ...(enqueueToConsumeMs != null ? { 'outbox.enqueueToConsumeMs': enqueueToConsumeMs } : {}),
    });

    const execute = async (): Promise<ComputedOutboxWakeupHandlerOutcome> => {
      const parked = await this.parkIfConnectionUnavailable(wakeup, startedAt, rootSpan);
      if (parked) return parked;

      let admittedOperationStarted = false;
      let admission;
      try {
        const admissionStartedAt = performance.now();
        admission = await this.baseAdmission.runWithPermit(wakeup.baseId, (permit) => {
          admittedOperationStarted = true;
          rootSpan.setAttribute(
            'outbox.admissionWaitMs',
            Math.round(performance.now() - admissionStartedAt)
          );
          rootSpan.setAttribute('outbox.admission', 'admitted');
          return this.handleAdmitted(wakeup, startedAt, permit, rootSpan);
        });
      } catch (error) {
        if (!admittedOperationStarted) {
          this.metrics.recordConsume('error');
          this.metrics.recordExecutionDuration(performance.now() - startedAt, 'error');
        }
        rootSpan.recordError(error instanceof Error ? error.message : String(error));
        throw error;
      }
      if (admission.admitted) {
        rootSpan.setAttribute('outbox.outcome', admission.value.status);
        return admission.value;
      }

      rootSpan.setAttribute('outbox.admission', 'deferred');
      const deferNowMs = Date.now();
      const deferDelayMs = stableAdmissionDeferDelayMs(wakeup.baseId, wakeup.taskId);
      const availableAt = new Date(deferNowMs + deferDelayMs);
      const baseWakeupId = `cuwd-admit-${wakeup.taskId}-${Math.floor(
        availableAt.getTime() / ADMISSION_DEFER_SPREAD_MS
      )}`;
      const wakeupId =
        wakeup.wakeupId === baseWakeupId || wakeup.wakeupId.startsWith(`${baseWakeupId}-r`)
          ? `${baseWakeupId}-r${Math.floor(deferNowMs / ADMISSION_DEFER_MIN_MS)}`
          : baseWakeupId;
      try {
        await this.wakeupPublisher.publish(
          createComputedOutboxWakeup({
            wakeupId,
            taskId: wakeup.taskId,
            baseId: wakeup.baseId,
            availableAt,
            cause: 'replay',
            ...(wakeup.traceparent ? { traceparent: wakeup.traceparent } : {}),
            ...(wakeup.tracestate ? { tracestate: wakeup.tracestate } : {}),
          })
        );
      } catch (error) {
        this.metrics.recordConsume('error');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'error');
        rootSpan.recordError(error instanceof Error ? error.message : String(error));
        throw error;
      }
      this.metrics.recordConsume('deferred');
      this.metrics.recordExecutionDuration(performance.now() - startedAt, 'deferred');
      rootSpan.setAttribute('outbox.outcome', 'deferred');
      rootSpan.setAttribute('outbox.deferReason', 'admission');
      this.logger.debug('computed:outbox:wakeup_admission_deferred', {
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        availableAt: availableAt.toISOString(),
      });
      return { status: 'deferred' };
    };

    try {
      return await wakeupTracer.withSpan(rootSpan, execute);
    } finally {
      rootSpan.end();
    }
  }

  private async handleAdmitted(
    wakeup: ComputedOutboxWakeupWire,
    startedAt: number,
    permit: ComputedOutboxBaseAdmissionPermit,
    parentSpan: ReturnType<ITracer['startSpan']>
  ): Promise<ComputedOutboxWakeupHandlerOutcome> {
    try {
      permit.assertActive();
      const container = await this.v2ContainerService.getContainerForBase(wakeup.baseId);

      // Fan-out enqueues one wakeup per task, but the first admitted wakeup's
      // post-process drain usually completes the base's whole backlog. Without
      // this pre-check every queued sibling pays a full claim transaction just
      // to discover a terminal task; one eligibility read answers that.
      // Non-terminal and errored reads fall through to the claim path, which
      // re-checks eligibility authoritatively.
      const precheckOutbox = container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      if (typeof precheckOutbox?.getTaskClaimEligibility === 'function') {
        const precheckResult = await precheckOutbox.getTaskClaimEligibility(wakeup.taskId);
        if (!precheckResult.isErr()) {
          const precheck = precheckResult.value;
          if (!precheck || precheck.status === 'terminal') {
            this.metrics.recordConsume('noop');
            this.metrics.recordExecutionDuration(performance.now() - startedAt, 'noop');
            parentSpan.setAttribute('outbox.precheck', 'terminal');
            return { status: 'noop' };
          }
        }
      }

      const worker = container.resolve<ComputedUpdateWorker>(
        v2RecordRepositoryPostgresTokens.computedUpdateWorker
      );
      const workerId = `computed-queue-${process.pid}`;
      const workerTracer = container.resolve<ITracer>(v2CoreTokens.tracer);
      permit.assertActive();

      const runTaskStartedAt = performance.now();
      const result = await worker.runTaskById({
        taskId: wakeup.taskId,
        workerId,
        tracer: workerTracer,
        // Healthy leases must not be stolen; claimById still reclaims expired processing.
        allowProcessingTakeover: false,
      });
      parentSpan.setAttribute(
        'outbox.runTaskByIdMs',
        Math.round(performance.now() - runTaskStartedAt)
      );
      if (result.isErr()) throw result.error;
      permit.assertActive();

      if (result.value) {
        // A processed seed/computed task can enqueue the next cascade stage (and bulk
        // dual-link writes leave sibling seed tasks pending). Drain them in-process
        // immediately instead of waiting for another BullMQ delivery or a multi-second
        // concurrency defer — this restores the T6191 "continue after any progress"
        // behavior after polling was replaced by BullMQ-only wake-ups.
        const drained = await this.drainRemainingOutbox(
          worker,
          workerId,
          wakeup.baseId,
          permit,
          workerTracer
        );
        parentSpan.setAttribute('outbox.drainTaskCount', drained);
        this.metrics.recordConsume('processed');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'processed');
        return { status: 'processed' };
      }

      parentSpan.setAttribute('outbox.taskClaimed', false);
      permit.assertActive();
      const outbox = container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const eligibilityResult = await outbox.getTaskClaimEligibility(wakeup.taskId);
      if (eligibilityResult.isErr()) throw eligibilityResult.error;
      permit.assertActive();

      const eligibility = eligibilityResult.value;
      if (!eligibility || eligibility.status === 'terminal') {
        this.metrics.recordConsume('noop');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'noop');
        return { status: 'noop' };
      }

      if (isIndefinitelyPaused(eligibility)) {
        this.metrics.recordConsume('parked');
        this.metrics.recordExecutionDuration(performance.now() - startedAt, 'parked');
        this.logger.debug('computed:outbox:wakeup_parked', {
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          reason: 'paused',
        });
        return { status: 'parked' };
      }

      // Finite pauses use the explicit resume time. Other transient misses use a deterministic
      // time bucket so duplicate locators converge without swallowing the next retry cycle.
      const { availableAt, wakeupId } = resolveDeferredWakeup(
        wakeup.taskId,
        wakeup.wakeupId,
        eligibility,
        Date.now()
      );
      permit.assertActive();
      await this.wakeupPublisher.publish(
        createComputedOutboxWakeup({
          wakeupId,
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          availableAt,
          cause: 'replay',
          ...(wakeup.traceparent ? { traceparent: wakeup.traceparent } : {}),
          ...(wakeup.tracestate ? { tracestate: wakeup.tracestate } : {}),
        })
      );
      this.metrics.recordConsume('deferred');
      this.metrics.recordExecutionDuration(performance.now() - startedAt, 'deferred');
      parentSpan.setAttribute(
        'outbox.deferReason',
        eligibility.status === 'deferred' ? eligibility.reason : eligibility.status
      );
      this.logger.debug('computed:outbox:wakeup_deferred', {
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        eligibility: eligibility.status,
        reason: eligibility.status === 'deferred' ? eligibility.reason : undefined,
        availableAt: availableAt.toISOString(),
      });
      return { status: 'deferred' };
    } catch (error) {
      return await this.handleAdmittedFailure(error, wakeup, startedAt, parentSpan);
    }
  }

  private async handleAdmittedFailure(
    error: unknown,
    wakeup: ComputedOutboxWakeupWire,
    startedAt: number,
    parentSpan: ReturnType<ITracer['startSpan']>
  ): Promise<ComputedOutboxWakeupHandlerOutcome> {
    // Base deletion can outlive its Redis locators. Routing fails before the
    // ledger precheck, so acknowledge only an authoritative missing-base result.
    if (error instanceof DataDbBaseNotFoundError && error.baseId === wakeup.baseId) {
      this.metrics.recordConsume('noop');
      this.metrics.recordExecutionDuration(performance.now() - startedAt, 'noop');
      parentSpan.setAttribute('outbox.precheck', 'base_not_found');
      return { status: 'noop' };
    }
    if (error instanceof DataDbBindingNotReadyError) {
      const outcome = await this.deferBindingNotReady(wakeup, startedAt, parentSpan, error);
      if (outcome) return outcome;
    }
    if (isLedgerReadOnlyError(error)) {
      const outcome = await this.deferReadOnlyLedger(wakeup, startedAt, parentSpan, error);
      if (outcome) return outcome;
    }
    this.metrics.recordConsume('error');
    this.metrics.recordExecutionDuration(performance.now() - startedAt, 'error');
    parentSpan.recordError(error instanceof Error ? error.message : String(error));
    throw error;
  }

  /**
   * Absorb a read-only-ledger failure into the per-base stepped wake-up.
   * Awaits the health report so sibling tasks in the same wave share
   * `healthChangedAt` and the same jobId. Returns null when the replacement
   * wake-up cannot be published, so the caller falls back to failing the
   * BullMQ job and the task is never silently dropped.
   */
  private async deferReadOnlyLedger(
    wakeup: ComputedOutboxWakeupWire,
    startedAt: number,
    parentSpan: ReturnType<ITracer['startSpan']>,
    cause: unknown
  ): Promise<ComputedOutboxWakeupHandlerOutcome | null> {
    await this.dataDbHealth?.reportWriteFailure({
      baseId: wakeup.baseId,
      message: describeUnknownError(cause),
    });
    const snapshot = await this.dataDbHealth?.getHealthSnapshotForBase(wakeup.baseId);
    const availableAt = await this.publishUnhealthyBackoff(wakeup, snapshot?.changedAt ?? null);
    if (!availableAt) return null;
    this.metrics.recordConsume('deferred');
    this.metrics.recordExecutionDuration(performance.now() - startedAt, 'deferred');
    parentSpan.setAttribute('outbox.outcome', 'deferred');
    parentSpan.setAttribute('outbox.deferReason', 'ledger_readonly');
    this.logger.warn('computed:outbox:ledger_readonly_deferred', {
      taskId: wakeup.taskId,
      baseId: wakeup.baseId,
      availableAt: availableAt.toISOString(),
      error: describeUnknownError(cause),
    });
    return { status: 'deferred' };
  }

  /**
   * Binding-not-ready is not a computed-task failure. Resolving the container
   * throws before the terminal-task precheck, so a throw here used to fail the
   * BullMQ job and the processor republished a 30s replay — filling Redis
   * failed history up to the retention cap with the same already-dead tasks.
   * Defer on the per-base unhealthy sentinel so deliveries converge until the
   * space's data-db binding is ready again.
   */
  private async deferBindingNotReady(
    wakeup: ComputedOutboxWakeupWire,
    startedAt: number,
    parentSpan: ReturnType<ITracer['startSpan']>,
    cause: DataDbBindingNotReadyError
  ): Promise<ComputedOutboxWakeupHandlerOutcome | null> {
    const availableAt = await this.publishUnhealthyBackoff(wakeup, null);
    if (!availableAt) return null;
    this.metrics.recordConsume('deferred');
    this.metrics.recordExecutionDuration(performance.now() - startedAt, 'deferred');
    parentSpan.setAttribute('outbox.outcome', 'deferred');
    parentSpan.setAttribute('outbox.deferReason', 'binding_not_ready');
    this.logger.warn('computed:outbox:binding_not_ready_deferred', {
      taskId: wakeup.taskId,
      baseId: wakeup.baseId,
      spaceId: cause.spaceId,
      availableAt: availableAt.toISOString(),
    });
    return { status: 'deferred' };
  }

  /**
   * Connection-level breaker: once health marks the base's database read-only
   * or unreachable, skip admission and the customer DB. One sentinel per base
   * carries the stepped backoff. A read_only sentinel live-probes so a quota
   * top-up resumes without waiting for the fleet sweep. Unreachable does not
   * dial the pooler — recovery is the sweep + recovered hook.
   */
  private async parkIfConnectionUnavailable(
    wakeup: ComputedOutboxWakeupWire,
    startedAt: number,
    parentSpan: ReturnType<ITracer['startSpan']>
  ): Promise<ComputedOutboxWakeupHandlerOutcome | null> {
    if (!this.dataDbHealth) return null;
    const snapshot = await this.dataDbHealth.getHealthSnapshotForBase(wakeup.baseId);
    if (snapshot.state !== 'read_only' && snapshot.state !== 'unreachable') return null;

    if (
      isUnhealthyByodbSentinel(wakeup.wakeupId, wakeup.baseId) &&
      snapshot.state === 'read_only'
    ) {
      const probed = await this.dataDbHealth.probeAndRefreshForBase(wakeup.baseId);
      if (probed !== 'read_only' && probed !== 'unreachable' && probed !== 'untracked') {
        return null;
      }
    }

    return await this.deferForUnavailableConnection(
      wakeup,
      startedAt,
      parentSpan,
      snapshot.state,
      snapshot.changedAt
    );
  }

  /**
   * Breaker variant of the unhealthy defer: driven by cached health, so it
   * neither re-reports nor warns per task.
   */
  private async deferForUnavailableConnection(
    wakeup: ComputedOutboxWakeupWire,
    startedAt: number,
    parentSpan: ReturnType<ITracer['startSpan']>,
    health: 'read_only' | 'unreachable',
    changedAt: Date | null
  ): Promise<ComputedOutboxWakeupHandlerOutcome | null> {
    const availableAt = await this.publishUnhealthyBackoff(wakeup, changedAt);
    if (!availableAt) return null;
    this.metrics.recordConsume('deferred');
    this.metrics.recordExecutionDuration(performance.now() - startedAt, 'deferred');
    parentSpan.setAttribute('outbox.outcome', 'deferred');
    parentSpan.setAttribute('outbox.deferReason', `connection_${health}`);
    this.logger.debug('computed:outbox:connection_unavailable_parked', {
      taskId: wakeup.taskId,
      baseId: wakeup.baseId,
      health,
      availableAt: availableAt.toISOString(),
    });
    return { status: 'deferred' };
  }

  /**
   * Publish the next per-base unhealthy sentinel. Duplicate jobId means another
   * task already scheduled this step — treat as accepted so we do not fall
   * through onto the customer database.
   */
  private async publishUnhealthyBackoff(
    wakeup: ComputedOutboxWakeupWire,
    changedAt: Date | null
  ): Promise<Date | null> {
    const defer = nextUnhealthyByodbDefer(wakeup.baseId, changedAt, Date.now());
    try {
      await this.wakeupPublisher.publish(
        createComputedOutboxWakeup({
          wakeupId: defer.wakeupId,
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          availableAt: defer.availableAt,
          cause: 'replay',
          ...(wakeup.traceparent ? { traceparent: wakeup.traceparent } : {}),
          ...(wakeup.tracestate ? { tracestate: wakeup.tracestate } : {}),
        })
      );
      return defer.availableAt;
    } catch (publishError) {
      if (isJobAlreadyExistsError(publishError)) return defer.availableAt;
      this.logger.warn('computed:outbox:ledger_readonly_defer_publish_failed', {
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        errorType: publishError instanceof Error ? publishError.name : 'UnknownError',
      });
      return null;
    }
  }

  /**
   * Keep claiming until an empty poll proves the outbox is idle for this worker.
   * Mirrors the pre-BullMQ polling continue_immediately policy (T6191).
   */
  private async drainRemainingOutbox(
    worker: ComputedUpdateWorker,
    workerId: string,
    baseId: string,
    permit: ComputedOutboxBaseAdmissionPermit,
    workerTracer?: ITracer
  ): Promise<number> {
    const span = wakeupTracer.startSpan('teable.computed.outbox.wakeup.drain', {
      'outbox.baseId': baseId,
      'worker.id': workerId,
    });

    const run = async (): Promise<number> => {
      let drained = 0;
      while (drained < POST_PROCESS_DRAIN_MAX_TASKS) {
        permit.assertActive();
        const more = await worker.runOnce({
          workerId,
          limit: POST_PROCESS_DRAIN_BATCH_SIZE,
          tracer: workerTracer,
        });
        permit.assertActive();
        if (more.isErr()) {
          span.recordError(more.error.message);
          this.logger.warn('computed:outbox:post_process_drain_failed', {
            baseId,
            workerId,
            drained,
            error: more.error.message,
          });
          return drained;
        }
        if (more.value <= 0) {
          if (drained > 0) {
            this.logger.debug('computed:outbox:post_process_drain_idle', {
              baseId,
              workerId,
              drained,
            });
          }
          span.setAttribute('outbox.drainTaskCount', drained);
          span.setAttribute('outbox.drainCapped', false);
          return drained;
        }
        drained += more.value;
        this.logger.debug('computed:outbox:post_process_drain_continue', {
          baseId,
          workerId,
          processed: more.value,
          drained,
        });
      }
      span.setAttribute('outbox.drainTaskCount', drained);
      span.setAttribute('outbox.drainCapped', true);
      this.logger.warn('computed:outbox:post_process_drain_capped', {
        baseId,
        workerId,
        drained,
        maxTasks: POST_PROCESS_DRAIN_MAX_TASKS,
      });
      return drained;
    };

    try {
      return await wakeupTracer.withSpan(span, run);
    } finally {
      span.end();
    }
  }
}
