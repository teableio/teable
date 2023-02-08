/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  IAddRowOpContext,
  ISetColumnMetaOpContext,
  IFieldSnapshot,
  IRecordSnapshot,
  FieldType,
  ISetRecordOpContext,
} from '@teable-group/core';
import { IdPrefix, OpName, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { groupBy, keyBy } from 'lodash';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import { FieldService } from '../../src/features/field/field.service';
import { createFieldInstance } from '../../src/features/field/model/factory';
import type { ISnapshotQuery } from '../../src/features/record/record.service';
import { RecordService } from '../../src/features/record/record.service';
import { getViewOrderFieldName } from '../../src/utils/view-order-field-name';
import type { CreateFieldRo } from '../features/field/model/create-field.ro';
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

/* eslint-disable @typescript-eslint/naming-convention */
interface IVisualTableDefaultField {
  __id: string;
  __version: number;
  __auto_number: number;
  __created_time: Date;
  __last_modified_time?: Date;
  __created_by: string;
  __last_modified_by?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

type IProjection = { [fieldKey: string]: boolean };

@Injectable()
export class SqliteDbAdapter extends ShareDb.DB {
  closed: boolean;
  projectsSnapshots = true;

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
    query: ISnapshotQuery,
    projection: IProjection,
    options: any,
    callback: ShareDb.DBQueryCallback
  ) => {
    this.queryPoll(collection, query, options, (error, ids) => {
      if (error) {
        return callback(error, []);
      }
      this.getSnapshotBulk(collection, ids, projection, options, (error, snapshots) => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        callback(error, snapshots!);
      });
    });
  };

  async queryPoll(
    collection: string,
    query: ISnapshotQuery,
    options: any,
    callback: (error: ShareDb.Error | null, ids: string[]) => void
  ) {
    const prisma = this.transactionService.get(collection);
    const { limit = 10 } = query;
    const idPrefix = collection.slice(0, 3);
    if (idPrefix !== IdPrefix.Table) {
      throw new Error('query collection must be table id');
    }

    if (limit > 1000) {
      throw new Error("limit can't be greater than 1000");
    }

    const sqlNative = await this.recordService.buildQuery(prisma, collection, {
      ...query,
      idOnly: true,
    });

    const result = await prisma.$queryRawUnsafe<{ __id: string }[]>(
      sqlNative.sql,
      ...sqlNative.bindings
    );

    callback(
      null,
      result.map((r) => r.__id)
    );
  }

  // Return true to avoid polling if there is no possibility that an op could
  // affect a query's results
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  skipPoll(
    collection: string,
    id: string,
    op: CreateOp | DeleteOp | EditOp,
    query: ISnapshotQuery
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

    const rowCount = await this.recordService.getRowCount(prisma, dbTableName);
    console.log('adding record: ', tableId, recordId);
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
    recordId: string,
    dbTableName: string,
    contexts: IAddRowOpContext[]
  ) {
    for (const context of contexts) {
      const { viewId, newOrder } = context;
      await prisma.$executeRawUnsafe(
        `UPDATE ${dbTableName} SET ${getViewOrderFieldName(viewId)} = ? WHERE __id = ?`,
        newOrder,
        recordId
      );
    }
  }

  private async setRecords(
    prisma: Prisma.TransactionClient,
    recordId: string,
    dbTableName: string,
    contexts: ISetRecordOpContext[]
  ) {
    const fieldIdsSet = contexts.reduce((acc, cur) => {
      return acc.add(cur.fieldId);
    }, new Set<string>());
    const fields = await prisma.field.findMany({
      where: { id: { in: Array.from(fieldIdsSet) } },
      select: { id: true, dbFieldName: true },
    });
    const fieldMap = keyBy(fields, 'id');

    const sqlForField = contexts
      .map((ctx) => {
        return `${fieldMap[ctx.fieldId].dbFieldName} = ?`;
      })
      .join(',');

    await prisma.$executeRawUnsafe(
      `UPDATE ${dbTableName} SET ${sqlForField} WHERE __id = ?`,
      ...contexts.map((ctx) => ctx.newValue),
      recordId
    );
  }

  private async addField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldSnapshot: IFieldSnapshot
  ) {
    const fieldInstance = createFieldInstance(fieldSnapshot.field as CreateFieldRo);

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

  private async setColumnMeta(
    prisma: Prisma.TransactionClient,
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
        data: { columnMeta: JSON.stringify(columnMeta) },
      });
    }
  }

  private async updateSnapshot(
    prisma: Prisma.TransactionClient,
    collection: string,
    docId: string,
    ops: IOtOperation[]
  ) {
    const dbTableName = await this.recordService.getDbTableName(prisma, collection);

    const ops2Contexts = OpBuilder.ops2Contexts(ops);
    // group by op name execute faster
    const ops2ContextsGrouped = groupBy(ops2Contexts, 'name');
    for (const opName in ops2ContextsGrouped) {
      const opContexts = ops2ContextsGrouped[opName];
      switch (opName) {
        case OpName.SetRecordOrder:
          await this.setRecordOrder(prisma, docId, dbTableName, opContexts as IAddRowOpContext[]);
          break;
        case OpName.SetRecord:
          await this.setRecords(prisma, docId, dbTableName, opContexts as ISetRecordOpContext[]);
          break;
        case OpName.SetColumnMeta:
          await this.setColumnMeta(prisma, docId, opContexts as ISetColumnMetaOpContext[]);
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
    try {
      const prisma = this.transactionService.get(collection);
      const opsResult = await prisma.ops.aggregate({
        _max: { version: true },
        where: { collection, docId: id },
      });

      const maxVersion = opsResult._max.version || 0;

      if (snapshot.v !== maxVersion + 1) {
        return callback(null, false);
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
        await this.updateSnapshot(prisma, collection, id, rawOp.op);
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
    const dbTableName = await this.recordService.getDbTableName(prisma, tableId);

    const allFields = await prisma.field.findMany({
      where: { tableId },
      select: { id: true, dbFieldName: true },
    });

    const allViews = await prisma.view.findMany({
      where: { tableId },
      select: { id: true },
    });
    const fieldNameOfViewOrder = allViews.map((view) => getViewOrderFieldName(view.id));

    const fields = projection ? allFields.filter((field) => projection[field.id]) : allFields;
    const columnSql = fields
      .map((f) => f.dbFieldName)
      .concat([
        '__id',
        '__version',
        '__auto_number',
        '__created_time',
        '__last_modified_time',
        '__created_by',
        '__last_modified_by',
        ...fieldNameOfViewOrder,
      ])
      .join(',');

    const result = await prisma.$queryRawUnsafe<
      ({ [fieldName: string]: unknown } & IVisualTableDefaultField)[]
    >(
      `SELECT ${columnSql} FROM ${dbTableName} WHERE __id IN (${recordIds
        .map(() => '?')
        .join(',')})`,
      ...recordIds
    );

    return result.map((record) => {
      const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
        acc[field.id] = record[field.dbFieldName];
        return acc;
      }, {});

      const recordOrder = fieldNameOfViewOrder.reduce<{ [viewId: string]: number }>(
        (acc, vFieldName, index) => {
          acc[allViews[index].id] = record[vFieldName] as number;
          return acc;
        },
        {}
      );

      return {
        id: record.__id,
        v: record.__version,
        type: 'json0',
        data: {
          record: {
            fields: fieldsData,
            id: record.__id,
          },
          recordOrder,
        },
      };
    });
  }

  private async getFieldSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldIds: string[]
  ): Promise<ISnapshotBase<IFieldSnapshot>[]> {
    const fields = await prisma.field.findMany({
      where: { tableId, id: { in: fieldIds } },
    });

    return fields.map((field) => {
      return {
        id: field.id,
        v: field.version,
        type: 'json0',
        data: {
          field: {
            id: field.id,
            name: field.name,
            type: field.type as FieldType,
            description: field.description || undefined,
            options: JSON.parse(field.options as string) || undefined,
            notNull: field.notNull || undefined,
            unique: field.unique || undefined,
            isPrimary: field.isPrimary || undefined,
            defaultValue: JSON.parse(field.defaultValue as string) || undefined,
          },
          columnMeta: JSON.parse(field.columnMeta),
        },
      };
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

      console.log('getOps:', { collection, id, from, to });
      console.log('getOps:result:', res);
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
