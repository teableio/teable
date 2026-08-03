import type { ISpan, ITracer, SpanAttributes, SpanAttributeValue } from '@teable/v2-core';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import type { TableSchemaStatementBuilder } from '../schema/rules/core';
import { executeTableSchemaStatements } from './db';

class FakeSpan implements ISpan {
  readonly attributes: Record<string, SpanAttributeValue> = {};
  readonly errors: string[] = [];
  ended = false;

  constructor(
    readonly name: string,
    attributes?: SpanAttributes
  ) {
    Object.assign(this.attributes, attributes);
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    this.attributes[key] = value;
  }

  setAttributes(attributes: SpanAttributes): void {
    Object.assign(this.attributes, attributes);
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  readonly spans: FakeSpan[] = [];

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan(name, attributes);
    this.spans.push(span);
    return span;
  }

  async withSpan<T>(_span: ISpan, callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  getActiveSpan(): ISpan | undefined {
    return this.spans.at(-1);
  }
}

const compiledQuery = (sql: string, parameters: unknown[] = []): CompiledQuery =>
  ({ sql, parameters }) as unknown as CompiledQuery;

const statement = (
  compiled: CompiledQuery,
  scope: TableSchemaStatementBuilder['scope'] = 'data'
): TableSchemaStatementBuilder => ({
  scope,
  compile: vi.fn(() => compiled),
});

const executorDb = (compiledSql: string | ReadonlyArray<string>) => {
  const compiledSqls = Array.isArray(compiledSql) ? [...compiledSql] : [compiledSql];
  let compileIndex = 0;
  const executeQuery = vi.fn(async () => ({ rows: [] }));
  const executor = {
    transformQuery: vi.fn((node) => node),
    compileQuery: vi.fn(() => {
      const sql = compiledSqls[compileIndex] ?? compiledSqls.at(-1) ?? 'select 1';
      compileIndex += 1;
      return compiledQuery(sql);
    }),
    executeQuery,
    withPlugins: vi.fn(() => executor),
  };

  return {
    executeQuery: vi.fn(async () => ({ rows: [] })),
    getExecutor: vi.fn(() => executor),
    executorExecuteQuery: executeQuery,
  } as unknown as Kysely<unknown> & {
    executorExecuteQuery: ReturnType<typeof vi.fn>;
  };
};

describe('executeTableSchemaStatements', () => {
  it('creates timing spans for each schema statement when a tracer is provided', async () => {
    const db = {
      executeQuery: vi.fn(async () => ({ rows: [] })),
    } as unknown as Kysely<unknown>;
    const tracer = new FakeTracer();

    await executeTableSchemaStatements(
      db,
      [
        statement(compiledQuery('alter table "tbl" add column "fld" text')),
        statement(compiledQuery('update "teable" set "fields" = $1', ['[]'])),
      ],
      {
        tracer,
        attributes: {
          'teable.table_id': 'tblTest',
        },
      }
    );

    expect(db.executeQuery).toHaveBeenCalledTimes(2);
    expect(tracer.spans).toHaveLength(2);
    expect(tracer.spans[0]?.name).toBe('teable.postgres.schema_statement.execute');
    expect(tracer.spans[0]?.attributes).toMatchObject({
      'teable.table_id': 'tblTest',
      'db.system': 'postgresql',
      'db.operation': 'ALTER TABLE',
      'teable.db.statement.index': 0,
      'teable.db.statement.count': 2,
      'teable.db.statement.parameter_count': 0,
    });
    expect(tracer.spans[0]?.attributes['teable.db.statement.duration_ms']).toEqual(
      expect.any(Number)
    );
    expect(tracer.spans[0]?.ended).toBe(true);
    expect(tracer.spans[1]?.attributes['db.operation']).toBe('UPDATE');
    expect(tracer.spans[1]?.attributes['teable.db.statement.parameter_count']).toBe(1);
  });

  it('records statement execution errors on the statement span', async () => {
    const error = new Error('schema update failed');
    const db = {
      executeQuery: vi.fn(async () => {
        throw error;
      }),
    } as unknown as Kysely<unknown>;
    const tracer = new FakeTracer();

    await expect(
      executeTableSchemaStatements(db, [statement(compiledQuery('drop index "idx"'))], { tracer })
    ).rejects.toThrow(error);

    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]?.errors).toEqual(['schema update failed']);
    expect(tracer.spans[0]?.ended).toBe(true);
  });

  it('rejects data-scoped statements that access metadata relations', async () => {
    const db = {
      executeQuery: vi.fn(async () => ({ rows: [] })),
    } as unknown as Kysely<unknown>;

    await expect(
      executeTableSchemaStatements(db, [statement(compiledQuery('select * from field'))], {
        enforceRelationAccess: true,
      })
    ).rejects.toThrow('cannot access relations owned by another storage plane');
    expect(db.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects data-scoped statements that access user metadata relations', async () => {
    const db = {
      executeQuery: vi.fn(async () => ({ rows: [] })),
    } as unknown as Kysely<unknown>;

    await expect(
      executeTableSchemaStatements(
        db,
        [
          statement(
            compiledQuery(
              'select u.id from public.users u join collaborator c on c.principal_id = u.id'
            )
          ),
        ],
        { enforceRelationAccess: true }
      )
    ).rejects.toThrow('cannot access relations owned by another storage plane');
    expect(db.executeQuery).not.toHaveBeenCalled();
  });

  it('allows metadata-scoped statements to access metadata relations', async () => {
    const db = {
      executeQuery: vi.fn(async () => ({ rows: [] })),
    } as unknown as Kysely<unknown>;

    await executeTableSchemaStatements(db, [
      statement(compiledQuery('update field set options = $1 where id = $2'), 'meta'),
    ]);

    expect(db.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects custom data executor statements that access metadata relations', async () => {
    const dataDb = executorDb('select * from field');
    const metaDb = executorDb('select * from field');
    const customStatement: TableSchemaStatementBuilder = {
      scope: 'data',
      compile: vi.fn(() => compiledQuery('select 1')),
      execute: async ({ dataDb }) => {
        await sql.raw('select * from field').execute(dataDb);
      },
    };

    await expect(
      executeTableSchemaStatements(dataDb, [customStatement], {
        dataDb,
        metaDb,
        enforceRelationAccess: true,
      })
    ).rejects.toThrow('cannot access relations owned by another storage plane');
    expect(dataDb.executorExecuteQuery).not.toHaveBeenCalled();
    expect(metaDb.executorExecuteQuery).not.toHaveBeenCalled();
  });

  it('allows custom statements to use each storage plane through the matching executor', async () => {
    const dataDb = executorDb('select * from "tblData"');
    const metaDb = executorDb('select * from field');
    const customStatement: TableSchemaStatementBuilder = {
      scope: 'meta',
      compile: vi.fn(() => compiledQuery('select * from field')),
      execute: async ({ dataDb, metaDb }) => {
        await sql.raw('select * from "tblData"').execute(dataDb);
        await sql.raw('select * from field').execute(metaDb);
      },
    };

    await executeTableSchemaStatements(metaDb, [customStatement], {
      dataDb,
      metaDb,
      enforceRelationAccess: true,
    });

    expect(dataDb.executorExecuteQuery).toHaveBeenCalledTimes(1);
    expect(metaDb.executorExecuteQuery).toHaveBeenCalledTimes(1);
  });
});
