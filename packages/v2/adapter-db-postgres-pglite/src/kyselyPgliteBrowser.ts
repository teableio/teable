/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable require-yield */
import { PGlite, type PGliteOptions } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely';

class PGliteDriver implements Driver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async destroy(): Promise<void> {
    await this.#client.close();
  }

  async init(): Promise<void> {}

  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}

class PGliteConnection implements DatabaseConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery<unknown>): Promise<QueryResult<R>> {
    const result = await this.#client.query(compiledQuery.sql, [...compiledQuery.parameters]);
    const numAffectedRows =
      result.affectedRows === undefined ? undefined : BigInt(result.affectedRows);
    return {
      rows: result.rows as R[],
      numAffectedRows,
    };
  }

  streamQuery<R>(
    _compiledQuery: CompiledQuery<unknown>,
    _chunkSize?: number
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite does not support streaming.');
  }
}

const resolvePgliteOptions = (
  dataDirOrOptions?: string | PGliteOptions
): PGliteOptions | undefined => {
  if (typeof dataDirOrOptions === 'string') {
    return { dataDir: dataDirOrOptions };
  }

  return dataDirOrOptions;
};

export class KyselyPGlite {
  client: PGlite;
  dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new PGliteDriver(this.client),
    createIntrospector: (db: unknown) => new PostgresIntrospector(db as never),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };

  constructor(dataDirOrOptionsOrPGlite?: string | PGliteOptions | PGlite) {
    if (dataDirOrOptionsOrPGlite instanceof PGlite) {
      this.client = dataDirOrOptionsOrPGlite;
      return;
    }

    const options = resolvePgliteOptions(dataDirOrOptionsOrPGlite);
    this.client = new PGlite(options?.dataDir, options);
  }

  static async create(dataDirOrOptions?: string | PGliteOptions) {
    const options = resolvePgliteOptions(dataDirOrOptions);
    const pg = await PGlite.create({
      ...options,
    });
    return new KyselyPGlite(pg);
  }
}
