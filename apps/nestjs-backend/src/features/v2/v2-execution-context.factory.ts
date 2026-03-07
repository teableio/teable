import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import type { IExecutionContext, ITracer } from '@teable/v2-core';
import { ActorId, DEFAULT_MAX_TABLE_FIELD_COUNT, v2CoreTokens } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { I18nContext, I18nService } from 'nestjs-i18n';

import type { IClsStore } from '../../types/cls';
import type { I18nTranslations } from '../../types/i18n.generated';
import { V2ContainerService } from './v2-container.service';

const defaultMaxSelectFieldOptionsPerField = 5000;
const maxSelectFieldOptionsPerFieldEnv = 'MAX_SELECT_FIELD_OPTIONS_PER_FIELD';
const maxTableFieldsPerTableEnv = 'MAX_TABLE_FIELDS_PER_TABLE';

const resolveNonNegativeInteger = (raw: string | undefined, fallback: number): number => {
  if (raw == null) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const resolveMaxSelectFieldOptionsPerField = (): number =>
  resolveNonNegativeInteger(
    process.env[maxSelectFieldOptionsPerFieldEnv],
    defaultMaxSelectFieldOptionsPerField
  );

const resolveMaxTableFieldsPerTable = (): number =>
  resolveNonNegativeInteger(process.env[maxTableFieldsPerTableEnv], DEFAULT_MAX_TABLE_FIELD_COUNT);

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

  /**
   * Creates a complete execution context with actorId, tracer, and requestId.
   * @throws HttpException if user.id is not available or ActorId creation fails
   */
  async createContext(): Promise<IExecutionContext> {
    const container = await this.v2ContainerService.getContainer();
    const tracer = container.resolve<ITracer>(v2CoreTokens.tracer);

    const userId = this.cls.get('user.id');
    if (!userId) {
      throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
    }

    const userName = this.cls.get('user.name');
    const userEmail = this.cls.get('user.email');

    const actorIdResult = ActorId.create(userId);
    if (actorIdResult.isErr()) {
      throw new HttpException(actorIdResult.error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Use CLS ID as requestId for ShareDB src matching (consistent with V1 batch.service)
    // This ensures the client that initiated the request can identify its own ops
    const requestId = this.cls.getId();

    // Get windowId from CLS for undo/redo tracking
    const windowId = this.cls.get('windowId');
    const t: NonNullable<IExecutionContext['$t']> = (key, options) =>
      this.i18n.t(`table.${key}` as never, {
        args: options,
        lang: I18nContext.current()?.lang ?? 'en',
      }) as string;

    const context: IExecutionContext = {
      actorId: actorIdResult.value,
      tracer,
      requestId,
      windowId,
      config: {
        selectFieldOptions: {
          maxChoicesPerField: resolveMaxSelectFieldOptionsPerField(),
        },
        tableFields: {
          maxFieldsPerTable: resolveMaxTableFieldsPerTable(),
        },
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
