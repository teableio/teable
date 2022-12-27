/* eslint-disable @typescript-eslint/no-explicit-any */
import Sqlite from 'better-sqlite3';
import ShareDb from 'sharedb';
import type { RawOp } from 'sharedb/lib/sharedb';

export class SqliteDB extends ShareDb.DB {
  sqlite: Sqlite.Database;
  closed: boolean;

  constructor(param: { filename: string | Buffer; options?: Sqlite.Options }) {
    super();

    this.closed = false;
    this.sqlite = new Sqlite(param.filename, param.options);
  }

  close(callback: () => void) {
    this.closed = true;
    this.sqlite.close();

    if (callback) callback();
  }

  // Persists an op and snapshot if it is for the next version. Calls back with
  // callback(err, succeeded)
  commit(
    collection: string,
    id: string,
    op: RawOp,
    snapshot: any,
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
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const res: { max_version: null | number } = this.sqlite
        .prepare('SELECT max(version) AS max_version FROM ops WHERE collection = ? AND doc_id = ?')
        .get([collection, id]);

      const maxVersion = Number(res.max_version);
      if (snapshot.v !== maxVersion + 1) {
        return callback(null, false);
      }

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
        insertOpStmt.run([collection, id, snapshot.v, JSON.stringify(op)]);
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
