import { Injectable } from '@nestjs/common';
import { getPostgresTransaction, pgErrorCode } from '@teable/v2-adapter-db-postgres-shared';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import {
  ConvertLinkFieldsToTextCommand,
  domainError,
  v2CoreTokens,
  type IInternalCommandBus,
  type IExecutionContext,
  type ISchemaOperationRepository,
  type IUnitOfWork,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import { DatabaseRouter } from '../../global/database-router.service';
import { FieldCacheService } from '../field-cache/field-cache.service';
import { TableIndexService } from '../table-index/table-index.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { throwV2Error } from '../v2/v2-http-error';
import { CrossSpaceLinkConversionRecoveryService } from './cross-space-link-conversion-recovery.service';

const conversionTimeoutError = (error: unknown) => {
  switch (pgErrorCode(error)) {
    case '55P03':
      return domainError.conflict({
        code: 'base.move_busy',
        message: 'A table needed for the base move is busy. Retry the move later.',
      });
    case '57014':
      return domainError.conflict({
        code: 'base.move_interrupted',
        message: 'The base move was interrupted. Retry the move later.',
      });
    default:
      throw error;
  }
};

/** Native pair conversion uses durable compensation across split data/meta commits. */
@Injectable()
export class CrossSpaceLinkCleanupService {
  constructor(
    private readonly containers: V2ContainerService,
    private readonly contexts: V2ExecutionContextFactory,
    private readonly router: DatabaseRouter,
    private readonly fieldCache: FieldCacheService,
    private readonly recovery: CrossSpaceLinkConversionRecoveryService,
    private readonly indexes: TableIndexService
  ) {}

  async withConversions<T>(
    baseId: string,
    conversionOrder: ReadonlyArray<{ tableId: string; fieldId: string }>,
    work: (context: IExecutionContext, metaDb: Transaction<V1TeableDatabase>) => Promise<T>
  ): Promise<T> {
    const container = await this.containers.getContainerForBase(baseId);
    const context = await this.contexts.createContext(container);
    const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const sourceUrl = await this.router.getDataDatabaseUrlForBase(baseId);
    for (const tableId of new Set(conversionOrder.map((target) => target.tableId))) {
      if ((await this.router.getDataDatabaseUrlForTable(tableId)) !== sourceUrl) {
        throw new Error('Cross-space field conversion requires one routed data database');
      }
    }
    const repository = container.resolve<ISchemaOperationRepository>(
      v2CoreTokens.schemaOperationRepository
    );
    const move = this.recovery.withRecovery(
      baseId,
      conversionOrder,
      context,
      repository,
      (receipt) =>
        unitOfWork.withTransaction(
          context,
          async (metaContext) =>
            unitOfWork.withTransaction(
              metaContext,
              async (transactionContext) => {
                const metaDb = getPostgresTransaction<V1TeableDatabase>(transactionContext, 'meta');
                const dataDb = getPostgresTransaction<V1TeableDatabase>(transactionContext, 'data');
                if (!metaDb || !dataDb)
                  throw new Error('Cross-space conversion requires active transactions');
                if (conversionOrder.length) {
                  const conversion = this.indexes.withQueryIndexesForLinkConversions(
                    transactionContext,
                    conversionOrder,
                    async () => {
                      await this.recovery.assertUnchanged(receipt, metaDb);
                      await this.recovery.prepareBackups(receipt, dataDb);
                      const command = ConvertLinkFieldsToTextCommand.create({
                        fields: conversionOrder,
                      });
                      if (command.isErr()) {
                        throwV2Error(
                          mapDomainErrorToHttpError(command.error),
                          mapDomainErrorToHttpStatus(command.error)
                        );
                      }
                      const converted = await container
                        .resolve<IInternalCommandBus>(v2CoreTokens.internalCommandBus)
                        .execute(transactionContext, command.value);
                      if (converted.isErr()) {
                        throwV2Error(
                          mapDomainErrorToHttpError(converted.error),
                          mapDomainErrorToHttpStatus(converted.error)
                        );
                      }
                    }
                  );
                  const failure = await conversion.catch(conversionTimeoutError);
                  if (failure) return err(failure);
                }
                return ok(await work(transactionContext, metaDb));
              },
              { scope: 'data', retry: false }
            ),
          { scope: 'meta', retry: false }
        )
    );
    const result = await move.catch((error: unknown) => err(conversionTimeoutError(error)));
    if (result.isErr()) {
      const { code } = result.error;
      const status =
        code === 'base.move_busy' || code === 'base.move_interrupted'
          ? 409
          : mapDomainErrorToHttpStatus(result.error);
      throwV2Error(mapDomainErrorToHttpError(result.error), status);
    }
    this.fieldCache.invalidateTables([...new Set(conversionOrder.map(({ tableId }) => tableId))]);
    return result.value;
  }
}
