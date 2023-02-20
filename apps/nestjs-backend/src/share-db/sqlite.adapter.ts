/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  ISetRecordOrderOpContext,
  ISetColumnMetaOpContext,
  IFieldSnapshot,
  IRecordSnapshot,
  ISetRecordOpContext,
  IAddColumnMetaOpContext,
  IRecordSnapshotQuery,
  IFieldSnapshotQuery,
  IRowCountQuery,
  ISetFieldNameOpContext,
} from '@teable-group/core';
import { SnapshotQueryType, IdPrefix, OpName, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { groupBy, keyBy } from 'lodash';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import { FieldService } from '../features/field/field.service';
import type { CreateFieldRo } from '../features/field/model/create-field.ro';
import { createFieldInstanceByRaw, createFieldInstanceByRo } from '../features/field/model/factory';
import type { FieldVo } from '../features/field/model/field.vo';
import { RecordService } from '../features/record/record.service';
import { TransactionService } from './transaction.service';

export interface ICollectionSnapshot {
  type: string;
  v: number;
  data: IRecord;
}

interface ISnapshotBase<T = unknown> {
  id: string;
  v: number;
  type: string | null;
  data: T;
  m?: unknown;
}

type IProjection = { [fieldKey: string]: boolean };

@Injectable()
export class SqliteDbAdapter extends ShareDb.DB {
  closed: boolean;

  constructor(
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
    private readonly transactionService: TransactionService
  ) {
    super();
    this.closed = false;
  }

  query = async (
    collection: string,
    query: IRecordSnapshotQuery | IFieldSnapshotQuery | IRowCountQuery,
    projection: IProjection,
    options: any,
    callback: ShareDb.DBQueryCallback
  ) => {
    console.log(`query: ${collection}`);
    this.queryPoll(collection, query, options, (error, results) => {
      // console.log('query pull result: ', ids);
      if (error) {
        return callback(error, []);
      }
      this.getSnapshotBulk(
        collection,
        results as string[],
        projection,
        options,
        (error, snapshots) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          callback(error, snapshots!);
        }
      );
    });
  };

  async queryPoll(
    collection: string,
    query: IRecordSnapshotQuery | IFieldSnapshotQuery | IRowCountQuery,
    options: any,
    callback: (error: ShareDb.Error | null, ids: string[]) => void
  ) {
    try {
      const prisma = this.transactionService.get(collection);
      let viewId = query.viewId;
      if (!viewId) {
        const view = await prisma.view.findFirstOrThrow({
          where: { tableId: collection },
          select: { id: true },
        });
        viewId = view.id;
      }

      if (query.type === SnapshotQueryType.Field) {
        const ids = await this.fieldService.getFieldIds(prisma, collection, viewId);
        callback(null, ids);
        return;
      }

      if (query.type === SnapshotQueryType.Record) {
        const ids = await this.recordService.getRecordIds(prisma, collection, { ...query, viewId });
        callback(null, ids);
        return;
      }

      if (query.type === SnapshotQueryType.RowCount) {
        callback(null, [`rowCount_${viewId}`]);
      }
    } catch (e) {
      callback(e as any, []);
    }
  }

  // Return true to avoid polling if there is no possibility that an op could
  // affect a query's results
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  skipPoll(
    collection: string,
    id: string,
    op: CreateOp | DeleteOp | EditOp,
    query: IRecordSnapshotQuery
  ): boolean {
    // ShareDB is in charge of doing the validation of ops, so at this point we
    // should be able to assume that the op is structured validly
    if (op.create || op.del) return false;
    return !op.op;
  }

  close(callback: () => void) {
    this.closed = true;

    if (callback) callback();
  }

  private async addRecord(prisma: Prisma.TransactionClient, tableId: string, recordId: string) {
    const dbTableName = await this.recordService.getDbTableName(prisma, tableId);

    const rowCount = await this.recordService.getAllRecordCount(prisma, dbTableName);
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${dbTableName} (__id, __row_default, __created_time, __created_by, __version) VALUES (?, ?, ?, ?, ?)`,
      recordId,
      rowCount,
      new Date(),
      'admin',
      1
    );
  }

  private async setRecordOrder(
    prisma: Prisma.TransactionClient,
    version: number,
    recordId: string,
    dbTableName: string,
    contexts: ISetRecordOrderOpContext[]
  ) {
    for (const context of contexts) {
      const { viewId, newOrder } = context;
      await this.recordService.setRecordOrder(
        prisma,
        version,
        recordId,
        dbTableName,
        viewId,
        newOrder
      );
    }
  }

  private async setRecords(
    prisma: Prisma.TransactionClient,
    version: number,
    recordId: string,
    dbTableName: string,
    contexts: ISetRecordOpContext[]
  ) {
    return await this.recordService.setRecord(prisma, version, recordId, dbTableName, contexts);
  }

  private async addField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldSnapshot: IFieldSnapshot
  ) {
    const fieldInstance = createFieldInstanceByRo(fieldSnapshot.field as CreateFieldRo);

    // 1. save field meta in db
    const multiFieldData = await this.fieldService.dbCreateMultipleField(prisma, tableId, [
      fieldInstance,
    ]);

    // 2. alter table with real field in visual table
    await this.fieldService.alterVisualTable(
      prisma,
      tableId,
      multiFieldData.map((field) => field.dbFieldName),
      [fieldInstance]
    );
  }

  private async addColumnMeta(
    prisma: Prisma.TransactionClient,
    version: number,
    fieldId: string,
    contexts: IAddColumnMetaOpContext[]
  ) {
    for (const context of contexts) {
      const { viewId, newMetaValue } = context;

      const fieldData = await prisma.field.findUniqueOrThrow({
        where: { id: fieldId },
        select: { columnMeta: true },
      });

      const columnMeta = JSON.parse(fieldData.columnMeta);

      Object.entries(newMetaValue).forEach(([key, value]) => {
        columnMeta[viewId][key] = value;
      });

      await prisma.field.update({
        where: { id: fieldId },
        data: { columnMeta: JSON.stringify(columnMeta), version },
      });
    }
  }

  private async setColumnMeta(
    prisma: Prisma.TransactionClient,
    version: number,
    fieldId: string,
    contexts: ISetColumnMetaOpContext[]
  ) {
    for (const context of contexts) {
      const { metaKey, viewId, newMetaValue } = context;

      const fieldData = await prisma.field.findUniqueOrThrow({
        where: { id: fieldId },
        select: { columnMeta: true },
      });

      const columnMeta = JSON.parse(fieldData.columnMeta);

      columnMeta[viewId][metaKey] = newMetaValue;

      await prisma.field.update({
        where: { id: fieldId },
        data: { columnMeta: JSON.stringify(columnMeta), version },
      });
    }
  }

  private async setFieldName(
    prisma: Prisma.TransactionClient,
    version: number,
    fieldId: string,
    contexts: ISetFieldNameOpContext[]
  ) {
    for (const context of contexts) {
      const { newName } = context;
      await prisma.field.update({
        where: { id: fieldId },
        data: { name: newName, version },
      });
    }
  }

  private async updateSnapshot(
    prisma: Prisma.TransactionClient,
    version: number,
    collection: string,
    docId: string,
    ops: IOtOperation[]
  ) {
    const dbTableName = await this.recordService.getDbTableName(prisma, collection);

    console.log('update snapshot', ops);

    const ops2Contexts = OpBuilder.ops2Contexts(ops);
    // group by op name execute faster
    const ops2ContextsGrouped = groupBy(ops2Contexts, 'name');
    for (const opName in ops2ContextsGrouped) {
      const opContexts = ops2ContextsGrouped[opName];
      switch (opName) {
        case OpName.SetRecordOrder:
          await this.setRecordOrder(
            prisma,
            version,
            docId,
            dbTableName,
            opContexts as ISetRecordOrderOpContext[]
          );
          break;
        case OpName.SetRecord:
          await this.setRecords(
            prisma,
            version,
            docId,
            dbTableName,
            opContexts as ISetRecordOpContext[]
          );
          break;
        case OpName.SetColumnMeta:
          await this.setColumnMeta(prisma, version, docId, opContexts as ISetColumnMetaOpContext[]);
          break;
        case OpName.AddColumnMeta:
          await this.addColumnMeta(prisma, version, docId, opContexts as IAddColumnMetaOpContext[]);
          break;
        case OpName.SetFieldName:
          await this.setFieldName(prisma, version, docId, opContexts as ISetFieldNameOpContext[]);
          break;
        default:
          throw new Error(`op name ${opName} save method did not implement`);
      }
    }
  }

  private async createSnapshot(
    prisma: Prisma.TransactionClient,
    collection: string,
    docId: string,
    snapshot: unknown
  ) {
    const docType = docId.slice(0, 3);
    switch (docType) {
      case IdPrefix.Record:
        await this.addRecord(prisma, collection, docId);
        break;
      case IdPrefix.Field:
        await this.addField(prisma, collection, snapshot as IFieldSnapshot);
        break;
      default:
        break;
    }
  }

  // Persists an op and snapshot if it is for the next version. Calls back with
  // callback(err, succeeded)
  async commit(
    collection: string,
    id: string,
    rawOp: CreateOp | DeleteOp | EditOp,
    snapshot: ICollectionSnapshot,
    options: any,
    callback: (err: unknown, succeed?: boolean) => void
  ) {
    /*
     * op: CreateOp {
     *   src: '24545654654646',
     *   seq: 1,
     *   v: 0,
     *   create: { type: 'http://sharejs.org/types/JSONv0', data: { ... } },
     *   m: { ts: 12333456456 } }
     * }
     * snapshot: PostgresSnapshot
     */

    // console.log('commit', collection, id, rawOp, snapshot);

    try {
      const prisma = this.transactionService.get(collection);
      const opsResult = await prisma.ops.aggregate({
        _max: { version: true },
        where: { collection, docId: id },
      });

      const maxVersion = opsResult._max.version || 0;

      if (snapshot.v !== maxVersion + 1) {
        return callback(
          new Error(`version mismatch: maxVersion: ${maxVersion} snapshotV: ${snapshot.v}`)
        );
      }

      // 1. save op in db;
      await prisma.ops.create({
        data: {
          docId: id,
          collection,
          version: snapshot.v,
          operation: JSON.stringify(rawOp),
        },
      });

      // create snapshot
      if (rawOp.create) {
        await this.createSnapshot(prisma, collection, id, rawOp.create.data);
      }

      // update snapshot
      if (rawOp.op) {
        await this.updateSnapshot(prisma, snapshot.v, collection, id, rawOp.op);
      }

      callback(null, true);
    } catch (err) {
      callback(err);
    }
  }

  /**
   * get record snapshot from db
   * @param tableId
   * @param recordIds
   * @param projection projection for fieldIds
   * @returns snapshotData
   */
  private async getRecordSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordIds: string[],
    projection?: IProjection
  ): Promise<ISnapshotBase<IRecordSnapshot>[]> {
    return await this.recordService.getRecordSnapshotBulk(prisma, tableId, recordIds, projection);
  }

  private async getFieldSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldIds: string[]
  ): Promise<ISnapshotBase<IFieldSnapshot>[]> {
    const fields = await prisma.field.findMany({
      where: { tableId, id: { in: fieldIds } },
    });
    const fieldInstances = fields.map((field) => createFieldInstanceByRaw(field));

    return fields
      .sort((a, b) => fieldIds.indexOf(a.id) - fieldIds.indexOf(b.id))
      .map((field, i) => {
        return {
          id: field.id,
          v: field.version,
          type: 'json0',
          data: {
            field: instanceToPlain(fieldInstances[i]) as FieldVo,
            columnMeta: JSON.parse(field.columnMeta),
          },
        };
      });
  }

  private async getRowCountBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    rowCountIds: string[]
  ): Promise<ISnapshotBase<number>[]> {
    const rowCounts: number[] = [];
    for (const id of rowCountIds) {
      const viewId = id.split('_')[1];
      const count = await this.recordService.getRowCount(prisma, tableId, viewId);
      rowCounts.push(count);
    }

    return rowCounts.map((count, i) => {
      return { id: rowCountIds[i], v: 1, type: 'json0', data: count };
    });
  }

  // Get the named document from the database. The callback is called with (err,
  // snapshot). A snapshot with a version of zero is returned if the document
  // has never been created in the database.
  async getSnapshotBulk(
    collection: string,
    ids: string[],
    projection: IProjection | undefined,
    options: any,
    callback: (err: ShareDb.Error | null, data?: Snapshot[]) => void
  ) {
    try {
      const prisma = this.transactionService.get(collection);
      const docType = ids[0].slice(0, 3);
      if (ids.find((id) => id.slice(0, 3) !== docType)) {
        throw new Error('get snapshot bulk ids must be same type');
      }

      let snapshotData: ISnapshotBase[] = [];
      switch (docType) {
        case IdPrefix.Record:
          snapshotData = await this.getRecordSnapshotBulk(
            prisma,
            collection,
            ids,
            // Do not project when called by ShareDB submit
            projection && projection['$submit'] ? undefined : projection
          );
          break;
        case IdPrefix.Field:
          snapshotData = await this.getFieldSnapshotBulk(prisma, collection, ids);
          break;
        case IdPrefix.Row: {
          snapshotData = await this.getRowCountBulk(prisma, collection, ids);
          break;
        }
        default:
          break;
      }

      if (snapshotData.length) {
        const snapshots = snapshotData.map(
          (snapshot) =>
            new Snapshot(
              snapshot.id,
              snapshot.v,
              snapshot.type,
              snapshot.data,
              undefined // TODO: metadata
            )
        );
        callback(null, snapshots);
      } else {
        const snapshots = ids.map((id) => new Snapshot(id, 0, null, undefined, undefined));
        callback(null, snapshots);
      }
    } catch (err) {
      callback(err as any);
    }
  }

  async getSnapshot(
    collection: string,
    id: string,
    projection: IProjection | undefined,
    options: any,
    callback: (err: unknown, data?: Snapshot) => void
  ) {
    this.getSnapshotBulk(collection, [id], projection, options, (err, data) => {
      if (err) {
        callback(err);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        callback(null, data![0]);
      }
    });
  }

  // Get operations between [from, to) non-inclusively. (Ie, the range should
  // contain start but not end).
  //
  // If end is null, this function should return all operations from start onwards.
  //
  // The operations that getOps returns don't need to have a version: field.
  // The version will be inferred from the parameters if it is missing.
  //
  // Callback should be called as callback(error, [list of ops]);
  async getOps(
    collection: string,
    id: string,
    from: number,
    to: number,
    options: any,
    callback: (error: unknown, data?: any) => void
  ) {
    try {
      const prisma = this.transactionService.get(collection);
      const res = await prisma.$queryRawUnsafe<
        { collection: string; id: string; from: number; to: number }[]
      >(
        'SELECT version, operation FROM ops WHERE collection = ? AND doc_id = ? AND version >= ? AND version < ?',
        collection,
        id,
        from,
        to
      );

      callback(
        null,
        res.map(function (row: any) {
          return row.operation;
        })
      );
    } catch (err) {
      callback(err);
    }
  }
}

class Snapshot implements ShareDb.Snapshot {
  constructor(
    public id: string,
    public v: number,
    public type: string | null,
    public data: any,
    public m: any
  ) {}
}
