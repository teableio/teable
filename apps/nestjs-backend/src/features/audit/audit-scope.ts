import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CreateRecordAction, UpdateRecordAction } from '@teable/openapi';
import { nanoid } from 'nanoid';
import { ClsService } from 'nestjs-cls';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';

export type IAuditAction = CreateRecordAction | UpdateRecordAction | string;

// Cap for how long we keep an eye on a single audit write before logging timeout.
// The underlying Promise isn't cancellable, but stopping tracking unblocks GC and
// surfaces slow writes as log lines.
const auditEmitTimeoutMs = 5000;

/**
 * Declares the audit attribution for a logical operation. When set in CLS, downstream
 * audit rows keep their atomic action and attach this operation as `payload.rootAction`.
 *
 * Single value (not a stack): the outermost operation owns attribution. Inner
 * `withOperation` calls open a child ALS context that keeps the existing operation, so
 * async listeners spawned inside still see the original root after the outer fn returns.
 *
 * No aggregation: each downstream event/emit writes its own audit row.
 */
export interface IAuditOperation {
  rootAction: IAuditAction;
  resourceId?: string;
  // Stable id shared by every audit row produced inside this operation. Lets queries group
  // "all rows from this one operation". Defaults to a fresh nanoid if not supplied.
  operationId: string;
  // Optional override for the audit row's user_id field. Used for automation/AI internal
  // calls so dashboards filtering by `user_id = 'automationRobot'` keep working.
  userId?: string;
  // Optional extra payload to merge into the audit row's payload.
  params?: Record<string, unknown>;
}

export interface INewAuditOperationInput {
  rootAction: IAuditAction;
  resourceId?: string;
  operationId?: string;
  userId?: string;
  params?: Record<string, unknown>;
}

export interface IEmitAtomicAuditInput {
  action: IAuditAction;
  resourceId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

@Injectable()
export class AuditScope {
  private readonly logger = new Logger(AuditScope.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /** Returns the current audit operation set by an enclosing withOperation(). */
  current(): IAuditOperation | undefined {
    return this.cls.get('audit');
  }

  /**
   * Overwrite the active operation's resourceId. Use when an operation is opened with a placeholder
   * (e.g. fromBaseId on a template apply) and the canonical target id only materializes
   * mid-method (e.g. the newly created base id). Subsequent emitAtomic() calls and downstream
   * consumers of `current().resourceId` will see the new value. No-op when no operation active.
   */
  setResourceId(resourceId: string): void {
    const operation = this.cls.get('audit');
    if (!operation) return;
    this.cls.set('audit', { ...operation, resourceId });
  }

  /**
   * Emit one atomic audit row. The row's `action` is explicit, while the active
   * operation contributes attribution (`rootAction`, `operationId`, params, userId).
   *
   * `params` is merged on top of `operation.params` for this emit only —
   * lets a method body augment fields the decorator could only declare statically
   * (e.g. an `oldRole` that requires a mid-method DB lookup). Does NOT write back to CLS.
   *
   * Single-action chains (atomic action equals the operation rootAction) omit
   * `rootAction` to avoid duplicating the same value.
   *
   * No-op when neither an active operation nor an explicit resourceId exists. Fires
   * `Events.AUDIT_LOG_EMIT` which the generic
   * `AuditLogListener.handleAuditLogEmit` writes to the database.
   */
  async emitAtomic(input: IEmitAtomicAuditInput): Promise<void> {
    const operation = this.cls.get('audit');
    const resourceId = input.resourceId ?? operation?.resourceId;
    if (!resourceId) return;

    const {
      action: _payloadAction,
      resourceId: _payloadResourceId,
      userId: _payloadUserId,
      params: _payloadParams,
      rootAction: _payloadRootAction,
      operationId: _payloadOperationId,
      ...payload
    } = input.payload ?? {};
    const rootAction =
      operation?.rootAction && operation.rootAction !== input.action
        ? operation.rootAction
        : undefined;
    const mergedParams = input.params
      ? { ...(operation?.params ?? {}), ...input.params }
      : operation?.params;

    await this.scheduleEmit({
      ...payload,
      action: input.action,
      resourceId,
      userId: input.userId ?? operation?.userId,
      params: mergedParams,
      ...(rootAction ? { rootAction } : {}),
      ...(operation?.operationId ? { operationId: operation.operationId } : {}),
    });
  }

  private async scheduleEmit(event: {
    action: IAuditAction;
    resourceId: string;
    userId?: string;
    params?: Record<string, unknown>;
    rootAction?: string;
    operationId?: string;
    [key: string]: unknown;
  }): Promise<void> {
    // Fire-and-forget with timeout: audit is observability, must not block business
    // requests. The listener (handleAuditLogEmit) writes in the background; on
    // timeout or error we just log.
    const writePromise = this.eventEmitter.emitAsync(Events.AUDIT_LOG_EMIT, event);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`audit emit timed out after ${auditEmitTimeoutMs}ms`));
      }, auditEmitTimeoutMs);
      timeoutHandle.unref?.();
    });
    Promise.race([writePromise, timeoutPromise])
      .then(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      })
      .catch((err: unknown) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.logger.error(
          `audit emit failed for action=${event.action} resourceId=${event.resourceId}: ${
            (err as Error)?.message ?? err
          }`,
          (err as Error)?.stack
        );
      });
  }

  /**
   * Run `fn` with audit operation attribution set on CLS.
   *
   * Uses `cls.runWith` to open a child AsyncLocalStorage context so async listeners
   * spawned inside `fn` still see the operation after `fn` resolves — important because
   * many domain events fire via `bindAfterTransaction → ops2Event → emitAsync` which
   * is fire-and-forget and outlives the synchronous fn body.
   */
  async withOperation<T>(input: INewAuditOperationInput, fn: () => Promise<T>): Promise<T> {
    const currentStore = this.cls.get() as IClsStore;
    const existing = currentStore.audit;

    if (existing) {
      return this.cls.runWith({ ...currentStore, audit: existing }, fn);
    }

    const operation: IAuditOperation = {
      rootAction: input.rootAction,
      operationId: input.operationId ?? nanoid(),
      ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.params !== undefined ? { params: input.params } : {}),
    };
    return this.cls.runWith({ ...currentStore, audit: operation }, fn);
  }
}
