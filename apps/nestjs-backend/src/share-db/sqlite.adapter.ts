/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  IAddRowOpContext,
  IAddFieldOpContext,
  IAddRecordOpContext,
  IAddColumnOpContext,
} from '@teable-group/core';
import { OpName, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { dbPath } from '@teable-group/db-main-prisma';
import Sqlite from 'better-sqlite3';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import { FieldService } from '../../src/features/field/field.service';
import { createFieldInstance } from '../../src/features/field/model/factory';
import { RecordService } from '../../src/features/record/record.service';
import { ROW_INDEX_FIELD_PREFIX } from '../../src/features/view/constant';
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

  private async addRecord(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    context: IAddRecordOpContext
  ) {
    const { recordId } = context;
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

  private async addRow(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    context: IAddRowOpContext
  ) {
    const { recordId, viewId, rowIndex } = context;
    await prisma.$executeRawUnsafe(
      `UPDATE ${dbTableName} SET ${ROW_INDEX_FIELD_PREFIX}_${viewId} = ? WHERE recordId = ?`,
      rowIndex,
      recordId
    );
  }

  private async addField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    context: IAddFieldOpContext
  ) {
    const { fieldId, fieldType, fieldName, defaultValue, options } = context;
    const fieldInstance = createFieldInstance({
      ...context,
      id: fieldId,
      type: fieldType,
      name: fieldName,
      defaultValue: defaultValue as any,
      options: options as any,
    });

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

  private async addColumn(
    prisma: Prisma.TransactionClient,
    tableId: string,
    context: IAddColumnOpContext
  ) {
    const { columnIndex, viewId, column } = context;

    const view = await prisma.view.findUniqueOrThrow({
      where: { id: viewId },
      select: { id: true, columns: true },
    });

    const columns = JSON.parse(view.columns);

    // columns has been mutated
    columns.splice(columnIndex, 0, column);

    await prisma.view.update({
      where: { id: viewId },
      data: { columns: JSON.stringify(columns) },
    });
  }

  private async updateSnapshotByOps(
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
        case OpName.AddRecord:
          await this.addRecord(prisma, dbTableName, opContext);
          break;
        case OpName.AddRow:
          await this.addRow(prisma, dbTableName, opContext);
          break;
        case OpName.AddField:
          await this.addField(prisma, collection, opContext);
          break;
        case OpName.AddColumn:
          await this.addColumn(prisma, collection, opContext);
          break;
        default:
          break;
      }
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

        // 2. parse op and update snapshot
        if (rawOp.op) {
          await this.updateSnapshotByOps(prisma, collection, id, rawOp.op);
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
