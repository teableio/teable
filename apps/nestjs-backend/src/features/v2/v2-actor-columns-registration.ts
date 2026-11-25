import { createHash } from 'node:crypto';
import { IdPrefix } from '@teable/core';
import {
  ActorColumnsEnableHandler,
  SchemaOperationRunnerService,
  v2CoreTokens,
  type ActorColumnsTarget,
  type IExecutionContext,
  type ISchemaOperationHandler,
  type ISchemaOperationRepository,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { ClsService } from 'nestjs-cls';
import type { IRawOpMap } from '../../share-db/interface';
import type { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';

/** Request and worker recovery use the same real metadata Edit and explicit flush. */
export const publishActorColumnsMetadata = async (
  shareDb: ShareDbService,
  cls: ClsService<IClsStore>,
  target: { baseId: string; tableId: string; tableVersion: number }
): Promise<void> => {
  const rawOps: IRawOpMap = {
    [`${IdPrefix.Table}_${target.baseId}`]: {
      [target.tableId]: {
        src: cls.getId() || 'unknown',
        seq: 1,
        m: { ts: Date.now() },
        v: target.tableVersion,
        op: [
          { p: ['actorStorageVersion'], od: 0, oi: 1 },
          { p: ['version'], od: target.tableVersion, oi: target.tableVersion + 1 },
        ],
      },
    },
  };
  await shareDb.publishOpsMap([rawOps]);
};

/** Hash the actual server-resolved URL, never an HTTP-provided database identifier. */
export const actorColumnsRuntimeRouteKey = (connectionString: string, internalSchema?: string) =>
  createHash('sha256')
    .update(connectionString)
    .update('\0')
    .update(internalSchema ?? '')
    .digest('hex');

export const registerActorColumnsEnableHandler = (
  container: DependencyContainer,
  connectionString: string,
  internalSchema?: string,
  onPublished?: (context: IExecutionContext, target: ActorColumnsTarget) => Promise<void>
): void => {
  const operations = container.resolve<ISchemaOperationRepository>(
    v2CoreTokens.schemaOperationRepository
  );
  const handlers = [
    ...container.resolve<ReadonlyArray<ISchemaOperationHandler>>(
      v2CoreTokens.schemaOperationHandlers
    ),
    new ActorColumnsEnableHandler(
      operations,
      container.resolve(v2CoreTokens.tableRepository),
      container.resolve(v2CoreTokens.tableSchemaRepository),
      container.resolve(v2CoreTokens.tableSchemaCoordination),
      container.resolve(v2CoreTokens.unitOfWork),
      actorColumnsRuntimeRouteKey(connectionString, internalSchema),
      onPublished
    ),
  ];
  container.registerInstance(v2CoreTokens.schemaOperationHandlers, handlers);
  container.registerInstance(
    v2CoreTokens.schemaOperationRunnerService,
    new SchemaOperationRunnerService(operations, handlers)
  );
};
