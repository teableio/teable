/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  IAddRowOpContext,
  ISetColumnMetaOpContext,
  IFieldSnapshot,
} from '@teable-group/core';
import { IdPrefix, OpName, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { dbPath } from '@teable-group/db-main-prisma';
import Sqlite from 'better-sqlite3';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import type { CreateFieldDto } from 'src/features/field/create-field.dto';
import { FieldService } from '../../src/features/field/field.service';
import { createFieldInstance } from '../../src/features/field/model/factory';
import { RecordService } from '../../src/features/record/record.service';
import { ROW_ORDER_FIELD_PREFIX } from '../../src/features/view/constant';
import { PrismaService } from '../../src/prisma.service';

export interface ICollectionSnapshot {
  type: string;
  v: number;
  data: IRecord;
}

@Injectable()
export class SqliteDbAdapter extends ShareDb.DB {
  sqlite: Sqlite.Database;
  closed: boolean;
  projectsSnapshots = true;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService
  ) {
    super();

    this.closed = false;
    this.sqlite = new Sqlite(dbPath);
  }

  close(callback: () => void) {
    this.closed = true;
    this.sqlite.close();

    if (callback) callback();
  }

  private async addRecord(prisma: Prisma.TransactionClient, tableId: string, recordId: string) {
    const tableMeta = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    const dbTableName = tableMeta.dbTableName;

    const rowCount = await this.recordService.getRowCount(prisma, dbTableName);
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${dbTableName} (__id, __row_default, __created_time, __created_by, __version) VALUES (?, ?, ?, ?, ?)`,
      recordId,
      rowCount,
      new Date(),
      'admin',
      0
    );
  }

  private async setRecordOrder(
    prisma: Prisma.TransactionClient,
    recordId: string,
    dbTableName: string,
    context: IAddRowOpContext
  ) {
    const { viewId, newOrder } = context;
    await prisma.$executeRawUnsafe(
      `UPDATE ${dbTableName} SET ${ROW_ORDER_FIELD_PREFIX}_${viewId} = ? WHERE recordId = ?`,
      newOrder,
      recordId
    );
  }

  private async addField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldSnapshot: IFieldSnapshot
  ) {
    const fieldInstance = createFieldInstance(fieldSnapshot.field as CreateFieldDto);

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
    context: ISetColumnMetaOpContext
  ) {
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

  private async updateSnapshot(
    prisma: Prisma.TransactionClient,
    collection: string,
    docId: string,
    ops: IOtOperation[]
  ) {
    const tableMeta = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: collection },
      select: { dbTableName: true },
    });
    const dbTableName = tableMeta.dbTableName;

    const ops2Contexts = OpBuilder.ops2Contexts(ops);
    // TODO: group and batch update maybe faster;
    for (const opContext of ops2Contexts) {
      switch (opContext.name) {
        case OpName.SetRecordOrder:
          await this.setRecordOrder(prisma, docId, dbTableName, opContext);
          break;
        case OpName.SetColumnMeta:
          await this.setColumnMeta(prisma, docId, opContext);
          break;
        default:
          break;
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
      const opsResult = await this.prismaService.ops.aggregate({
        _max: { version: true },
        where: { collection, docId: id },
      });

      const maxVersion = opsResult._max.version || 0;

      if (snapshot.v !== maxVersion + 1) {
        return callback(null, false);
      }

      this.prismaService.$transaction(async (prisma) => {
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
      });

      const insertOpStmt = this.sqlite.prepare(
        'INSERT INTO ops (collection, doc_id, version, operation) VALUES (?, ?, ?, ?)'
      );
      const insertSnapshotStmt =
        snapshot.v === 1
          ? this.sqlite.prepare(
              'INSERT INTO snapshots (collection, doc_id, doc_type, version, data) VALUES ($1, $2, $3, $4, $5)'
            )
          : this.sqlite.prepare(
              'UPDATE snapshots SET doc_type = $3, version = $4, data = $5 WHERE collection = $1 AND doc_id = $2 AND version = ($4 - 1)'
            );

      const transaction = this.sqlite.transaction(() => {
        insertOpStmt.run([collection, id, snapshot.v, JSON.stringify(rawOp)]);
        insertSnapshotStmt.run({
          [1]: collection,
          [2]: id,
          [3]: snapshot.type,
          [4]: snapshot.v,
          [5]: JSON.stringify(snapshot.data),
        });
      });

      transaction();

      callback(null, true);
    } catch (err) {
      callback(err);
    }
  }

  // Get the named document from the database. The callback is called with (err,
  // snapshot). A snapshot with a version of zero is returned if the document
  // has never been created in the database.
  getSnapshot(
    collection: string,
    id: string,
    fields: string[],
    options: any,
    callback: (err: unknown, data: any) => void
  ) {
    const res = this.sqlite
      .prepare(
        'SELECT version, data, doc_type FROM snapshots WHERE collection = ? AND doc_id = ? LIMIT 1'
      )
      .get([collection, id]);

    console.log('getSnapshot:', res);
    if (res) {
      const snapshot = new Snapshot(
        id,
        res.version,
        res.doc_type,
        JSON.parse(res.data),
        undefined // TODO: metadata
      );
      callback(null, snapshot);
    } else {
      const snapshot = new Snapshot(id, 0, null, undefined, undefined);
      callback(null, snapshot);
    }
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
  getOps(
    collection: string,
    id: string,
    from: number,
    to: number,
    options: any,
    callback: (error: unknown, data?: any) => void
  ) {
    try {
      const res = this.sqlite
        .prepare(
          'SELECT version, operation FROM ops WHERE collection = ? AND doc_id = ? AND version >= ? AND version < ?'
        )
        .all([collection, id, from, to]);
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

class Snapshot {
  constructor(
    public id: string,
    public v: number,
    public type: string | null,
    public data: any,
    public m: any
  ) {}
}
