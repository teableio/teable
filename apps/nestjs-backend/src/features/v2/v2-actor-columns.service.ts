import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { APP_ROBOT_ID, isAnonymous } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableActorColumnsVo } from '@teable/openapi';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import {
  v2CoreTokens,
  type ActorColumnsTarget,
  type IExecutionContext,
  type ISchemaOperationRepository,
  type SchemaOperationRecord,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import {
  actorColumnsRuntimeRouteKey,
  publishActorColumnsMetadata,
} from './v2-actor-columns-registration';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { throwV2Error } from './v2-http-error';

// Platform operators only: the AppRobot holds base-scoped table|update, so the
// generic permission check cannot distinguish an app session from an operator.
export const assertPlatformOperatorActor = (cls: ClsService<IClsStore>): void => {
  const userId = cls.get('user.id');
  if (
    !userId ||
    isAnonymous(userId) ||
    userId === APP_ROBOT_ID ||
    cls.get('appId') ||
    cls.get('tempAuthBaseId')
  ) {
    throw new ForbiddenException('Record attribution can only be enabled by a platform operator');
  }
};

const safeFailureSummaries: ReadonlyMap<string, string> = new Map([
  [
    'actor_columns.incompatible_schema',
    'Existing record attribution columns have an incompatible shape or constraint.',
  ],
  [
    'actor_columns.business_collision',
    'A business field uses a reserved record attribution column.',
  ],
  [
    'actor_columns.route_mismatch',
    'The table database binding changed. Retry to recheck the current target.',
  ],
  [
    'actor_columns.fence_lost',
    'The enable operation lost its schema lease. Retry to recheck the table.',
  ],
  [
    'actor_columns.lease_lost',
    'The enable operation lost its schema lease. Retry to recheck the table.',
  ],
]);

const publicOperation = (
  operation: SchemaOperationRecord
): NonNullable<ITableActorColumnsVo['operation']> => {
  const result =
    operation.result && typeof operation.result === 'object'
      ? (operation.result as Record<string, unknown>)
      : {};
  const code =
    typeof result.actorColumnsFailureCode === 'string' ? result.actorColumnsFailureCode : '';
  return {
    id: operation.id,
    status: operation.status,
    phase: operation.phase,
    attempts: operation.attempts,
    maxAttempts: operation.maxAttempts,
    // Never expose the runner's SQL/driver error, URL, or routing payload.
    lastError: operation.lastError
      ? (safeFailureSummaries.get(code) ??
        'Record attribution enable failed. Retry to recheck the table schema.')
      : null,
    nextRunAt: operation.nextRunAt.toISOString(),
  };
};

const actorColumnsStatus = (
  tableId: string,
  version: number,
  operation?: SchemaOperationRecord
): ITableActorColumnsVo => {
  const enabled = version === 1;
  let state: ITableActorColumnsVo['state'] = 'disabled';
  if (enabled) state = 'ready';
  else if (operation)
    state = operation.status === 'error' || operation.status === 'dead' ? 'error' : 'pending';
  return {
    tableId,
    actorStorageVersion: enabled ? 1 : 0,
    state,
    ...(operation ? { operation: publicOperation(operation) } : {}),
  };
};

@Injectable()
export class V2ActorColumnsService {
  private readonly logger = new Logger(V2ActorColumnsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly databases: DataDbClientManager,
    private readonly migrationGuard: SpaceDataDbMigrationGuardService,
    private readonly cls: ClsService<IClsStore>,
    private readonly audit: AuditScope,
    private readonly moduleRef: ModuleRef,
    private readonly shareDb: ShareDbService
  ) {}

  async getStatus(baseId: string, tableId: string): Promise<ITableActorColumnsVo> {
    const userId = this.cls.get('user.id');
    if (!userId || isAnonymous(userId)) throw new UnauthorizedException();
    const table = await this.prisma.tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null, base: { deletedTime: null } },
      select: { actorStorageVersion: true },
    });
    if (!table) throw new NotFoundException('Table not found');
    const container = await this.containers.getContainer();
    const context = await this.contexts.createContext(container);
    const operations = container.resolve<ISchemaOperationRepository>(
      v2CoreTokens.schemaOperationRepository
    );
    const listed = await operations.list(context, {
      types: ['table.actor_columns.enable'],
      tableIds: [tableId],
      limit: 1,
    });
    if (listed.isErr())
      throwV2Error(
        mapDomainErrorToHttpError(listed.error),
        mapDomainErrorToHttpStatus(listed.error)
      );
    const operation = listed.value.items.find(
      (item) => item.idempotencyKey === `table:${tableId}:actor_columns:v1`
    );
    if (table.actorStorageVersion === 1 && operation?.status === 'ready') {
      await this.replayMetadataNotification(baseId, tableId, context, operations, operation);
    }
    return actorColumnsStatus(tableId, table.actorStorageVersion, operation);
  }

  private async replayMetadataNotification(
    baseId: string,
    tableId: string,
    context: IExecutionContext,
    operations: ISchemaOperationRepository,
    operation: SchemaOperationRecord
  ): Promise<void> {
    if (!operations.markActorColumnsNotified) return;
    if (!operation.result || typeof operation.result !== 'object') return;
    const delivery = operation.result as Record<string, unknown>;
    if (
      delivery.notificationDelivered !== false ||
      delivery.baseId !== baseId ||
      delivery.tableId !== tableId
    )
      return;
    if (typeof delivery.oldVersion !== 'number' || typeof delivery.newVersion !== 'number') return;
    if (delivery.newVersion !== delivery.oldVersion + 1) return;
    try {
      await publishActorColumnsMetadata(this.shareDb, this.cls, {
        baseId,
        tableId,
        tableVersion: delivery.oldVersion,
      });
      const acknowledged = await operations.markActorColumnsNotified(context, operation);
      if (acknowledged.isErr())
        this.logger.warn('Record attribution metadata notification acknowledgement pending');
    } catch {
      this.logger.warn('Record attribution metadata notification delivery pending');
    }
  }

  @Audit({
    action: 'table.update',
    resourceId: (_baseId: string, tableId: string) => tableId,
    emit: { change: 'actorStorageVersion', targetVersion: 1 },
  })
  async enable(baseId: string, tableId: string): Promise<ITableActorColumnsVo> {
    assertPlatformOperatorActor(this.cls);
    const status = await this.getStatus(baseId, tableId);
    if (status.actorStorageVersion === 1) return status;
    if (status.operation?.status === 'pending' || status.operation?.status === 'running')
      return status;
    return this.enqueueCurrentTarget(baseId, tableId);
  }

  private async enqueueCurrentTarget(
    baseId: string,
    tableId: string
  ): Promise<ITableActorColumnsVo> {
    await this.migrationGuard.assertTableWritable(tableId);
    const database = await this.databases.getDataDatabaseForBase(baseId);
    const container = await this.containers.getContainerForBase(baseId);
    const context = await this.contexts.createContext(container);
    const operations = container.resolve<ISchemaOperationRepository>(
      v2CoreTokens.schemaOperationRepository
    );
    if (!operations.getActorColumnsTarget || !operations.enqueueActorColumns) {
      throw new ServiceUnavailableException('Record attribution enable is unavailable');
    }
    const target = await operations.getActorColumnsTarget(
      context,
      baseId,
      tableId,
      actorColumnsRuntimeRouteKey(database.connectionUrl ?? database.url, database.internalSchema)
    );
    if (target.isErr())
      throwV2Error(
        mapDomainErrorToHttpError(target.error),
        mapDomainErrorToHttpStatus(target.error)
      );
    if (
      target.value.connectionId !== (database.connectionId ?? null) ||
      target.value.internalSchema !== (database.internalSchema ?? null)
    ) {
      throw new ConflictException('Record attribution target database binding changed');
    }
    return this.enqueueTarget(baseId, tableId, context, operations, target.value);
  }

  private async enqueueTarget(
    baseId: string,
    tableId: string,
    context: IExecutionContext,
    operations: ISchemaOperationRepository,
    target: ActorColumnsTarget
  ): Promise<ITableActorColumnsVo> {
    const enqueued = await operations.enqueueActorColumns!(context, target);
    if (enqueued.isOk()) return actorColumnsStatus(tableId, 0, enqueued.value);
    // A committed capability must never be rearmed from a stale API snapshot.
    if (enqueued.error.code === 'actor_columns.fence_lost') {
      const current = await this.getStatus(baseId, tableId);
      if (current.actorStorageVersion === 1) return current;
    }
    throwV2Error(
      mapDomainErrorToHttpError(enqueued.error),
      mapDomainErrorToHttpStatus(enqueued.error)
    );
  }
}
