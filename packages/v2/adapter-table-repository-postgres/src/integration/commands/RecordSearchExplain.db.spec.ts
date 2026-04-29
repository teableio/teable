/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateTableCommand,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateTableResult,
  type Field,
  type ICommandBus,
  RecordSearch,
  type Table,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { CompiledQuery, Expression, Kysely, SqlBool } from 'kysely';
import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildRecordSearchWhereClause } from '../../record/repository/RecordSearchWhereBuilder';
import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type ExplainNode = {
  'Node Type'?: string;
  Plans?: ExplainNode[];
};

type ExplainOutput = {
  Plan: ExplainNode;
};

const createContext = () => {
  const actorIdResult = ActorId.create('system');
  return { actorId: actorIdResult._unsafeUnwrap() };
};

const getDbTableLocation = (table: Table, defaultSchema: string) => {
  const dbTableName = table.dbTableName()._unsafeUnwrap().split({ defaultSchema })._unsafeUnwrap();
  return {
    schemaName: dbTableName.schema ?? defaultSchema,
    tableName: dbTableName.tableName,
    fullTableName: `${dbTableName.schema ?? defaultSchema}.${dbTableName.tableName}`,
  };
};

const getFieldByName = (table: Table, name: string): Field => {
  return table.getField((candidate) => candidate.name().toString() === name)._unsafeUnwrap();
};

const compileDateSearchQuery = ({
  db,
  table,
  fullTableName,
  fieldId,
  value,
}: {
  db: Kysely<V1TeableDatabase>;
  table: Table;
  fullTableName: string;
  fieldId: string;
  value: string;
}): CompiledQuery => {
  const whereClause = buildRecordSearchWhereClause(
    table,
    {
      search: RecordSearch.fromTuple([value, fieldId, true]),
    },
    {
      tableAlias: 't',
    }
  )._unsafeUnwrap();

  let query = db.selectFrom(`${fullTableName} as t`).select('t.__id as id');
  if (whereClause != null) {
    query = query.where(whereClause as Expression<SqlBool>);
  }

  return query.compile();
};

const findMatchingRecordIds = async ({
  db,
  compiled,
}: {
  db: Kysely<V1TeableDatabase>;
  compiled: CompiledQuery;
}) => {
  const rows = await db.executeQuery<{ id: string }>({
    ...compiled,
    parameters: [...compiled.parameters],
  });

  return rows.rows.map((row) => row.id);
};

const explainQueryPlan = async ({
  db,
  compiled,
}: {
  db: Kysely<V1TeableDatabase>;
  compiled: CompiledQuery;
}): Promise<ExplainOutput> => {
  const rows = await db.transaction().execute(async (trx) => {
    await trx.executeQuery(sql.raw('SET LOCAL enable_seqscan = off').compile(trx));
    const explainQuery = sql`EXPLAIN (FORMAT JSON) ${sql.raw(compiled.sql)}`.compile(trx);
    return trx.executeQuery<{ 'QUERY PLAN': string | object }>({
      ...explainQuery,
      parameters: [...compiled.parameters],
    });
  });

  const rawPlan = rows.rows[0]?.['QUERY PLAN'];
  if (rawPlan == null) {
    throw new Error('Missing EXPLAIN output');
  }

  if (typeof rawPlan === 'object') {
    return (Array.isArray(rawPlan) ? rawPlan[0] : rawPlan) as ExplainOutput;
  }

  return (JSON.parse(rawPlan) as ExplainOutput[])[0] as ExplainOutput;
};

const flattenNodeTypes = (node: ExplainNode): string[] => {
  const nodeType = node['Node Type'] ? [node['Node Type']] : [];
  const childTypes = node.Plans?.flatMap(flattenNodeTypes) ?? [];
  return [...nodeType, ...childTypes];
};

describe('RecordSearch EXPLAIN (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('uses the datetime search index for field-specific date search', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const context = createContext();

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Search Explain',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const createdTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult
    );
    const createdTable = createdTableResult._unsafeUnwrap().table;
    const titleField = getFieldByName(createdTable, 'Title');
    const titleDbFieldName = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const { schemaName, tableName, fullTableName } = getDbTableLocation(
      createdTable,
      baseId.toString()
    );

    await sql
      .raw(
        `CREATE INDEX "idx_trgm_bootstrap_date_search" ON "${schemaName}"."${tableName}" USING btree ("${titleDbFieldName}")`
      )
      .execute(db);

    const createFieldResult = CreateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: createdTable.id().toString(),
      field: {
        type: 'date',
        name: 'Due',
      },
    })._unsafeUnwrap();

    const updatedTableResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      createFieldResult
    );
    const updatedTable = updatedTableResult._unsafeUnwrap().table;
    const dueField = getFieldByName(updatedTable, 'Due');
    const dueFieldId = dueField.id().toString();
    const dueDbFieldName = dueField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    const dateIndexRows = await sql<{ indexdef: string }>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = ${schemaName}
        AND tablename = ${tableName}
        AND indexname LIKE 'idx_trgm%'
        AND indexdef LIKE ${`%USING btree ("${dueDbFieldName}")%`}
    `.execute(db);

    expect(dateIndexRows.rows).toHaveLength(1);

    const records = [
      { title: 'Alpha', due: '2026-02-23T00:00:00.000Z' },
      { title: 'Bravo', due: '2026-02-24T00:00:00.000Z' },
      { title: 'Charlie', due: '2026-02-25T00:00:00.000Z' },
    ];

    for (const record of records) {
      const createRecordResult = CreateRecordCommand.create({
        tableId: updatedTable.id().toString(),
        fields: {
          [titleField.id().toString()]: record.title,
          [dueFieldId]: record.due,
        },
      })._unsafeUnwrap();

      const execResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        context,
        createRecordResult
      );
      execResult._unsafeUnwrap();
    }

    const compiled = compileDateSearchQuery({
      db,
      table: updatedTable,
      fullTableName,
      fieldId: dueFieldId,
      value: '2026-02-24',
    });

    const matchingIds = await findMatchingRecordIds({ db, compiled });
    expect(matchingIds).toHaveLength(1);

    const explain = await explainQueryPlan({ db, compiled });
    const nodeTypes = flattenNodeTypes(explain.Plan);

    expect(nodeTypes.some((nodeType) => nodeType.includes('Index'))).toBe(true);
    expect(nodeTypes.every((nodeType) => nodeType !== 'Seq Scan')).toBe(true);
  });
});
