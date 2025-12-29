/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable require-yield */
import { PGlite, type PGliteOptions } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection() {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async destroy() {
    await this.#client.close();
  }

  async init() {}

  async releaseConnection(_connection: PGliteConnection) {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery(compiledQuery: CompiledQuery) {
    return this.#client.query(compiledQuery.sql, [...compiledQuery.parameters]);
  }

  async *streamQuery() {
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
  dialect = {
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
