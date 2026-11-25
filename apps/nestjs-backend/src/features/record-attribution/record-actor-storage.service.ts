import type { OnModuleDestroy } from '@nestjs/common';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@teable/db-main-prisma';
import { V2PgTableSchemaCoordination } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId } from '@teable/v2-core';
import type { RecordInitiator } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore, IRecordActorStorageScope } from '../../types/cls';

export type RecordActorTableMeta = Readonly<{
  id: string;
  baseId: string;
  dbTableName: string;
  actorStorageVersion: 0 | 1;
}>;

/** Only authenticated host adapters populate recordInitiator. */
export const resolveRecordInitiator = (cls: ClsService<IClsStore>): RecordInitiator | undefined =>
  cls.get('recordInitiator');

/** Host schema coordination shared by native v2, import, and legacy/raw record writers. */
@Injectable()
export class RecordActorStorageService implements OnModuleDestroy {
  private readonly coordination: V2PgTableSchemaCoordination;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    config: ConfigService
  ) {
    this.coordination = new V2PgTableSchemaCoordination({
      connectionString:
        config.get<string>('PRISMA_META_DATABASE_URL') ??
        config.get<string>('PRISMA_DATABASE_URL') ??
        config.getOrThrow<string>('DATABASE_URL'),
      maxConnections: 8,
      lockTimeoutMillis: 3000,
      applicationName: 'teable-record-actor-storage',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.coordination.destroy();
  }

  async assertEnabled(tableId: string): Promise<void> {
    await this.withTableWrite(tableId, async (table) => {
      if (table.actorStorageVersion !== 1) {
        throw new ConflictException('Record attribution is not enabled for this table');
      }
    });
  }

  async withTableWrite<T>(
    tableId: string,
    action: (table: RecordActorTableMeta) => Promise<T>,
    options?: { provisioning?: true }
  ): Promise<T> {
    return this.withTablesWrite([tableId], (tables) => action(tables[0]!), options);
  }

  async withTablesWrite<T>(
    tableIds: ReadonlyArray<string>,
    action: (tables: ReadonlyArray<RecordActorTableMeta>) => Promise<T>,
    options?: { provisioning?: true }
  ): Promise<T> {
    const requested = [...new Set(tableIds)].sort();
    if (!requested.length) return action([]);
    const owner = this.transactionOwner();
    const existing = owner?.actorStorageScope ?? this.cls.get('actorStorageScope');
    const invoke = (scope: IRecordActorStorageScope) =>
      this.cls.runWith(
        { ...this.cls.get(), actorStorageScope: scope, actorStorageLeases: scope.tables },
        () => action(requested.map((id) => scope.tables.get(id)!))
      );
    if (existing?.active) {
      if (requested.some((id) => !existing.tables.has(id))) {
        throw new ConflictException(
          'Record write targets must be planned before acquiring schema leases'
        );
      }
      if (owner) (owner.schemaLeaseChecks ??= new Set()).add(existing.assertHeld);
      await existing.assertHeld();
      const result = await invoke(existing);
      await existing.assertHeld();
      return result;
    }

    const actor = ActorId.create(this.cls.get('user.id') ?? 'system');
    if (actor.isErr()) throw new ServiceUnavailableException('Unable to coordinate record write');
    const acquired = await this.coordination.acquire({ actorId: actor.value }, requested, 'shared');
    if (acquired.isErr()) {
      throw new ServiceUnavailableException('Unable to acquire the table schema lease');
    }
    const lease = acquired.value;
    const scope: IRecordActorStorageScope = {
      active: true,
      assertHeld: async () => {
        // This is only local socket/lease liveness. Enable publication separately
        // verifies the live backend PID/xid and advisory lock in its metadata CAS.
        if (!scope.active || lease.isActive !== true) {
          throw new ServiceUnavailableException('The table schema lease was lost');
        }
      },
      tableIds: requested,
      tables: new Map(),
    };
    let releaseAfterTransaction = false;
    const release = async () => {
      if (!scope.active) return;
      scope.active = false;
      scope.tables.clear();
      if (owner?.actorStorageScope === scope) delete owner.actorStorageScope;
      await lease.release();
    };
    try {
      this.cls.set('dataDbRoutingCache', undefined);
      this.cls.set('metaAncestryCache', undefined);
      // One fresh metadata read follows the complete, sorted lock acquisition.
      await this.populateTableMetadata(scope, requested, options);
      if (owner) {
        if (!owner.completionCallbacks) {
          throw new ServiceUnavailableException(
            'The record transaction does not own completion hooks'
          );
        }
        // Store the same mutable scope on the actual outer transaction, not only
        // on the child CLS context that disappears when this callback returns.
        owner.actorStorageScope = scope;
        (owner.schemaLeaseChecks ??= new Set()).add(scope.assertHeld);
        owner.completionCallbacks.push(release);
        releaseAfterTransaction = true;
      }
      await scope.assertHeld();
      const result = await invoke(scope);
      await scope.assertHeld();
      return result;
    } finally {
      if (!releaseAfterTransaction) await release();
    }
  }

  private transactionOwner() {
    const dataTransaction = this.cls.get('dataTx');
    if (dataTransaction?.client) return dataTransaction;
    const metadataTransaction = this.cls.get('tx');
    return metadataTransaction?.client ? metadataTransaction : undefined;
  }

  private async populateTableMetadata(
    scope: IRecordActorStorageScope,
    requested: ReadonlyArray<string>,
    options?: { provisioning?: true }
  ): Promise<void> {
    const rows = await this.prisma.txClient().tableMeta.findMany({
      where: {
        id: { in: [...requested] },
        deletedTime: null,
        provisionState: options?.provisioning ? { in: ['ready', 'pending'] } : 'ready',
      },
      select: { id: true, baseId: true, dbTableName: true, actorStorageVersion: true },
    });
    if (rows.length !== requested.length) throw new NotFoundException('Table not found');
    for (const row of rows) {
      if (row.actorStorageVersion !== 0 && row.actorStorageVersion !== 1) {
        throw new ConflictException('Unsupported record attribution storage version');
      }
      scope.tables.set(row.id, { ...row, actorStorageVersion: row.actorStorageVersion });
    }
  }
}
