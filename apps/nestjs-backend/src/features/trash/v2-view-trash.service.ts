import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  DurableProjectionHandler,
  ViewDeleted,
  type IDurableProjectionContext,
  type IDurableProjectionHandler,
  type ProjectionDeliveryError,
  type ProjectionDeliveryOutcome,
  type ProjectionMessageJson,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { buildViewTrashRow, type IViewTrashRow } from './view-trash-row';

export const V2_VIEW_TRASH_CONSUMER_ID = 'view.trash.v1';

type IViewTrashDataTransaction = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  tableTrash: {
    create(args: { data: IViewTrashRow }): PromiseLike<unknown>;
  };
};

type IViewTrashDataPrisma = {
  $transaction<T>(work: (tx: IViewTrashDataTransaction) => Promise<T>): Promise<T>;
};

@DurableProjectionHandler(ViewDeleted, 'table.view.deleted.v1', {
  id: V2_VIEW_TRASH_CONSUMER_ID,
  idempotency: 'destination-inbox',
  replay: 'forbidden',
})
export class V2ViewDeletedTrashProjection implements IDurableProjectionHandler<ProjectionMessageJson> {
  readonly consumerId = V2_VIEW_TRASH_CONSUMER_ID;

  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly prismaService: PrismaService
  ) {}

  async handle(
    context: IDurableProjectionContext,
    message: ProjectionMessageJson
  ): Promise<Result<ProjectionDeliveryOutcome, ProjectionDeliveryError>> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return err({
        code: 'view.trash.invalid_message',
        retryability: 'terminal',
        message: 'View trash requires a view deletion message',
      });
    }
    const { tableId, viewId, oldVersion } = message as {
      readonly [key: string]: ProjectionMessageJson;
    };
    if (typeof tableId !== 'string' || typeof viewId !== 'string' || !context.actorId) {
      return err({
        code: 'view.trash.invalid_message',
        retryability: 'terminal',
        message: 'View deletion message is missing table, view, or actor identity',
      });
    }

    try {
      const applied = await this.prismaService.$tx(async (metaTx) => {
        // Native restoration locks this retained row too. Keep the lock through
        // destination commit so delivery and restoration cannot overtake each other.
        const views = await metaTx.$queryRawUnsafe<{ deletedTime: Date | null; version: number }[]>(
          'SELECT deleted_time AS "deletedTime", version FROM view WHERE id = $1 AND table_id = $2 FOR UPDATE',
          viewId,
          tableId
        );
        const view = views[0];
        if (
          !view?.deletedTime ||
          (typeof oldVersion === 'number' && view.version !== oldVersion + 1)
        ) {
          return 'stale';
        }

        const dataPrisma = (await this.dataDbClientManager.dataPrismaForTable(
          tableId
        )) as unknown as IViewTrashDataPrisma;
        // A random id would create independent trash on a delivery retry.
        const operationId = `opr${createHash('sha256').update(context.eventId).digest('base64url').slice(0, 16)}`;
        const destinationResult = await dataPrisma.$transaction(async (tx) => {
          const inserted = await tx.$executeRawUnsafe(
            'INSERT INTO domain_event_inbox (consumer_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            this.consumerId,
            context.eventId
          );
          if (!inserted) return 'duplicate';
          await tx.tableTrash.create({
            data: buildViewTrashRow({
              operationId,
              tableId,
              viewId,
              userId: context.actorId,
              createdTime: context.occurredAt,
            }),
          });
          return 'applied';
        });
        return destinationResult;
      });
      return applied === 'applied'
        ? ok({
            kind: 'applied',
            effectReceipt: {
              kind: 'destination-inbox',
              identity: `${this.consumerId}:${context.eventId}`,
            },
          })
        : ok({
            kind: 'noop',
            reasonCode:
              applied === 'stale' ? 'view-no-longer-deleted' : 'view-trash-already-applied',
          });
    } catch (error) {
      return err({
        code: 'view.trash.persist_failed',
        retryability: 'retryable',
        message: error instanceof Error ? error.message : 'Failed to persist view trash',
      });
    }
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2ViewTrashService implements IV2ProjectionRegistrar {
  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly prismaService: PrismaService
  ) {}

  registerProjections(container: DependencyContainer): void {
    container.registerInstance(
      V2ViewDeletedTrashProjection,
      new V2ViewDeletedTrashProjection(this.dataDbClientManager, this.prismaService)
    );
  }
}
