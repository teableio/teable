import { Injectable } from '@nestjs/common';
import type { IGetFieldsQuery, ISnapshotBase } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IS_TEMPLATE_HEADER, BASE_SHARE_ID_HEADER } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { RawOpType, IShareDbReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';
import type { IReadonlyServiceContext } from './types';

type FieldSnapshot = ISnapshotBase<{
  recordRead?: boolean;
}>;

type FieldSnapshotWaiter = {
  ids: string[];
  resolve: (snapshots: FieldSnapshot[]) => void;
  reject: (error: unknown) => void;
};

type FieldSnapshotBatch = {
  tableId: string;
  ids: string[];
  waiters: FieldSnapshotWaiter[];
  cookie?: string;
  shareId?: string;
  baseShareId?: string;
  templateHeader?: string;
};

type FieldSnapshotInflight = {
  ids: string[];
  promise: Promise<FieldSnapshot[]>;
};

const FIELD_SNAPSHOT_BULK_CHUNK = 100;
const FIELD_SNAPSHOT_BULK_MAX_INFLIGHT = 16;

@Injectable()
export class FieldReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  private readonly snapshotBatches = new Map<string, FieldSnapshotBatch>();
  private readonly snapshotInflight = new Map<string, FieldSnapshotInflight>();
  private snapshotRunning = 0;
  private readonly snapshotWaiters: Array<() => void> = [];

  constructor(
    private readonly cls: ClsService<IReadonlyServiceContext>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetFieldsQuery = {}) {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
      ? `/share/${shareId}/socket/field/doc-ids`
      : `/table/${tableId}/field/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
          [BASE_SHARE_ID_HEADER]: baseShareId,
        },
        params: query,
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]): Promise<FieldSnapshot[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    const key = this.snapshotScopeKey(tableId);
    const flying = this.snapshotInflight.get(key);
    if (flying && ids.every((id) => flying.ids.includes(id))) {
      return flying.promise.then((snapshots) => {
        const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
        return ids
          .map((id) => byId.get(id))
          .filter((snapshot): snapshot is FieldSnapshot => snapshot != null);
      });
    }
    let batch = this.snapshotBatches.get(key);
    if (!batch) {
      const pending: FieldSnapshotBatch = {
        tableId,
        ids: [],
        waiters: [],
        cookie: this.cls.get('cookie'),
        shareId: this.cls.get('shareViewId'),
        baseShareId: this.cls.get('baseShareId'),
        templateHeader: this.cls.get('templateHeader'),
      };
      this.snapshotBatches.set(key, pending);
      setImmediate(() => {
        this.snapshotBatches.delete(key);
        let settle!: (value: Promise<FieldSnapshot[]>) => void;
        const promise = new Promise<FieldSnapshot[]>((resolve, reject) => {
          settle = (inner) => {
            void inner.then(resolve, reject);
          };
        });
        this.snapshotInflight.set(key, { ids: pending.ids, promise });
        settle(this.flushSnapshotBatch(pending));
        void promise.then(
          () => {
            if (this.snapshotInflight.get(key)?.promise === promise) {
              this.snapshotInflight.delete(key);
            }
          },
          () => {
            if (this.snapshotInflight.get(key)?.promise === promise) {
              this.snapshotInflight.delete(key);
            }
          }
        );
      });
      batch = pending;
    }
    const seen = new Set(batch.ids);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      batch.ids.push(id);
    }
    let resolve!: (snapshots: FieldSnapshot[]) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<FieldSnapshot[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    batch.waiters.push({ ids, resolve, reject });
    return promise;
  }

  private snapshotScopeKey(tableId: string): string {
    return [
      tableId,
      this.cls.get('cookie') ?? '',
      this.cls.get('shareViewId') ?? '',
      this.cls.get('baseShareId') ?? '',
      this.cls.get('templateHeader') ?? '',
    ].join('\0');
  }

  private async flushSnapshotBatch(batch: FieldSnapshotBatch): Promise<FieldSnapshot[]> {
    try {
      const snapshots = await this.requestSnapshotBulk(
        batch.tableId,
        batch.ids,
        batch.shareId,
        batch.baseShareId,
        batch.cookie,
        batch.templateHeader
      );
      const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
      for (const waiter of batch.waiters) {
        waiter.resolve(
          waiter.ids
            .map((id) => byId.get(id))
            .filter((snapshot): snapshot is FieldSnapshot => snapshot != null)
        );
      }
      return snapshots;
    } catch (error) {
      for (const waiter of batch.waiters) {
        waiter.reject(error);
      }
      throw error;
    }
  }

  private acquireSnapshotSlot(): Promise<void> {
    if (this.snapshotRunning < FIELD_SNAPSHOT_BULK_MAX_INFLIGHT) {
      this.snapshotRunning += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.snapshotWaiters.push(() => {
        this.snapshotRunning += 1;
        resolve();
      });
    });
  }

  private releaseSnapshotSlot(): void {
    this.snapshotRunning = Math.max(0, this.snapshotRunning - 1);
    const next = this.snapshotWaiters.shift();
    next?.();
  }

  private async requestSnapshotBulk(
    tableId: string,
    ids: string[],
    shareId?: string,
    baseShareId?: string,
    cookie?: string,
    templateHeader?: string
  ): Promise<FieldSnapshot[]> {
    await this.acquireSnapshotSlot();
    try {
      const useShareViewEndpoint = shareId && !baseShareId;
      const url = useShareViewEndpoint
        ? `/share/${shareId}/socket/field/snapshot-bulk`
        : `/table/${tableId}/field/socket/snapshot-bulk`;
      const headers = {
        cookie,
        [IS_TEMPLATE_HEADER]: templateHeader,
        [BASE_SHARE_ID_HEADER]: baseShareId,
      };
      const snapshots: FieldSnapshot[] = [];
      for (let offset = 0; offset < ids.length; offset += FIELD_SNAPSHOT_BULK_CHUNK) {
        const chunk = ids.slice(offset, offset + FIELD_SNAPSHOT_BULK_CHUNK);
        const response = await this.axios.get(url, {
          headers,
          params: { ids: chunk },
        });
        snapshots.push(...response.data);
      }
      return snapshots;
    } finally {
      this.releaseSnapshotSlot();
    }
  }

  getVersionAndType(tableId: string, fieldId: string) {
    return this.prismaService.field
      .findUnique({
        where: {
          id: fieldId,
          tableId,
        },
        select: {
          version: true,
          deletedTime: true,
        },
      })
      .then((res) => {
        return this.formatVersionAndType(res);
      });
  }

  getVersionAndTypeMap(tableId: string, fieldIds: string[]) {
    return this.prismaService.field
      .findMany({
        where: {
          id: { in: fieldIds },
          tableId,
        },
        select: {
          id: true,
          version: true,
          deletedTime: true,
        },
      })
      .then((fields) => {
        return fields.reduce(
          (acc, field) => {
            acc[field.id] = this.formatVersionAndType(field);
            return acc;
          },
          {} as Record<string, { version: number; type: RawOpType }>
        );
      });
  }
}
