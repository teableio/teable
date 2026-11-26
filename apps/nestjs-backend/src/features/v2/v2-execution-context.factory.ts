import { randomUUID } from 'node:crypto';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import {
  ActorId,
  v2CoreTokens,
  type FormulaSourceBudget,
  type IExecutionContext,
  type ITracer,
  type TableDataSafetyLimitConfig,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import { I18nContext, I18nService } from 'nestjs-i18n';

import type { IClsStore } from '../../types/cls';
import type { I18nTranslations } from '../../types/i18n.generated';
import { V2ContainerService } from './v2-container.service';

const appendWorkflowAttributes = (
  attributes: Record<string, string | boolean>,
  workflow: IClsStore['workflowContext']
): void => {
  if (!workflow?.workflowId) return;
  for (const key of ['workflowId', 'runId', 'actionId', 'workflowName', 'triggeredBy'] as const) {
    const value = workflow[key];
    if (typeof value === 'string') attributes[`automation.${key}`] = value;
  }
};

/**
 * Factory for creating V2 execution contexts with proper tracer and requestId injection.
 * Centralizes the context creation logic to ensure consistent tracing across all V2 operations.
 */
@Injectable()
export class V2ExecutionContextFactory {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly cls: ClsService<IClsStore>,
    private readonly i18n: I18nService<I18nTranslations>
  ) {}

  requireActorId(): ActorId {
    const userId = this.cls.get('user.id');
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    const actorIdResult = ActorId.create(userId);
    if (actorIdResult.isErr()) {
      throw new HttpException(actorIdResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return actorIdResult.value;
  }

  /**
   * Creates a complete execution context with actorId, tracer, and requestId.
   * Request abort signals are opt-in for streaming endpoints so synchronous
   * REST mutations remain atomic even if the client disconnects mid-request.
   * @throws HttpException if user.id is not available or ActorId creation fails
   */
  async createContext(
    container?: DependencyContainer,
    options?: { useRequestAbortSignal?: boolean }
  ): Promise<IExecutionContext> {
    container ??= await this.v2ContainerService.getContainer();
    const tracer = container.resolve<ITracer>(v2CoreTokens.tracer);
    const tableLimits = container.isRegistered(v2CoreTokens.tableDataSafetyLimits)
      ? container.resolve<TableDataSafetyLimitConfig>(v2CoreTokens.tableDataSafetyLimits)
      : undefined;
    const formulaSourceBudget = container.resolve<FormulaSourceBudget>(
      v2CoreTokens.formulaSourceBudget
    );

    const actorId = this.requireActorId();

    const userName = this.cls.get('user.name');
    const userEmail = this.cls.get('user.email');

    // Use CLS ID as requestId for ShareDB src matching (consistent with V1 batch.service)
    // This ensures the client that initiated the request can identify its own ops
    const requestId = this.cls.getId();

    // Get windowId from CLS for undo/redo tracking
    const windowId = this.cls.get('windowId');
    const scheduleBackgroundTask = this.cls.get('scheduleV2BackgroundTask');
    const requestAbortSignal = options?.useRequestAbortSignal
      ? this.cls.get('requestAbortSignal')
      : undefined;
    const permissions = this.cls.get('permissions');
    const allowSelectOptionAutoCreate = Array.isArray(permissions)
      ? permissions.includes('field|update')
      : undefined;
    const audit = this.cls.get('audit');
    const origin = this.cls.get('origin');
    const attributes: Record<string, string | boolean> = {};
    // Explicit public provenance allowlist; never copy CLS, headers or request data.
    if (origin?.via) attributes['origin.via'] = origin.via;
    if (typeof origin?.byApi === 'boolean') attributes['origin.byApi'] = origin.byApi;
    if (origin?.client) attributes['origin.client'] = origin.client;
    const appId = this.cls.get('appId');
    if (appId) attributes.appId = appId;
    appendWorkflowAttributes(attributes, this.cls.get('workflowContext'));
    const t: NonNullable<IExecutionContext['$t']> = (key, options) =>
      this.i18n.t(`table.${key}` as never, {
        args: options,
        lang: I18nContext.current()?.lang ?? 'en',
      }) as string;

    const context: IExecutionContext = {
      actorId,
      initiator: this.cls.get('recordInitiator'),
      requireActorStorage: this.cls.get('requireActorStorage'),
      operationAttribution: {
        operationId: audit?.operationId ?? randomUUID(),
        occurredAt: audit?.occurredAt ?? new Date().toISOString(),
        ...(audit?.rootAction ? { action: audit.rootAction } : {}),
        attributes: Object.freeze(attributes),
      },
      ...(requestAbortSignal ? { abortSignal: requestAbortSignal } : {}),
      tracer,
      requestId,
      windowId,
      scheduleBackgroundTask,
      config: {
        formulaSourceBudget,
        ...(tableLimits ? { tableLimits } : {}),
        ...(allowSelectOptionAutoCreate !== undefined ? { allowSelectOptionAutoCreate } : {}),
      },
      $t: t,
    };

    return {
      ...context,
      actorName: userName,
      actorEmail: userEmail,
    } as IExecutionContext;
  }
}
