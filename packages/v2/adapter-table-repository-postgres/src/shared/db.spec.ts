import type { ISpan, ITracer, SpanAttributes, SpanAttributeValue } from '@teable/v2-core';
import type { CompiledQuery, Kysely } from 'kysely';
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

const statement = (compiled: CompiledQuery): TableSchemaStatementBuilder => ({
  compile: vi.fn(() => compiled),
});

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
});
