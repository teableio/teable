import {
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DefaultTableMapper,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  FormulaMeta,
  Table,
  TableId,
  TableName,
  TimeZone,
  UpdateFormulaTimeZoneSpec,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { TableMetaUpdateVisitor } from './TableMetaUpdateVisitor';

describe('formula ownership persistence', () => {
  it('persists admission upgrades and prevents old snapshots downgrading stored ownership', async () => {
    const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    const pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
    const db = new Kysely<V1TeableDatabase>({ dialect: new PostgresDialect({ pool }) });
    try {
      await pool.query(`create table field (
        id text primary key, table_id text not null, options text, meta text,
        version integer, last_modified_time timestamptz, last_modified_by text,
        deleted_time timestamptz
      )`);
      const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
      const tableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
      const formulaId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
      const mapper = new DefaultTableMapper();
      const builder = Table.builder()
        .withBaseId(baseId)
        .withId(tableId)
        .withName(TableName.create('Formula ownership')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      builder
        .field()
        .formula()
        .withId(formulaId)
        .withName(FieldName.create('Formula')._unsafeUnwrap())
        .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
        .withResultType({
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .done();
      builder.view().defaultGrid().done();
      const source = builder.build()._unsafeUnwrap();
      const sourceDto = mapper.toDTO(source)._unsafeUnwrap();
      const cases = [
        { stored: undefined, incoming: 1, expected: 1 },
        { stored: 1, incoming: undefined, expected: 1 },
        { stored: 2, incoming: 1, expected: 2 },
      ];
      for (const scenario of cases) {
        const table = mapper
          .toDomain({
            ...sourceDto,
            fields: sourceDto.fields.map((field) =>
              field.type === 'formula' ? { ...field, meta: undefined } : field
            ),
          })
          ._unsafeUnwrap();
        const field = table.getField((item) => item.id().equals(formulaId))._unsafeUnwrap();
        if (!(field instanceof FormulaField)) throw new Error('Expected formula');
        if (scenario.incoming !== undefined) field.enableFormulaSafety(1)._unsafeUnwrap();
        const storedMeta = FormulaMeta.rehydrate({
          persistedAsGeneratedColumn: scenario.incoming === undefined,
          ...(scenario.stored === undefined ? {} : { formulaSafetyVersion: scenario.stored }),
        })
          ._unsafeUnwrap()
          .toDto()
          ._unsafeUnwrap();
        await pool.query('delete from field');
        await pool.query('insert into field (id, table_id, meta, version) values ($1, $2, $3, 1)', [
          formulaId.toString(),
          tableId.toString(),
          JSON.stringify(storedMeta),
        ]);
        const visitor = new TableMetaUpdateVisitor({
          db,
          table,
          tableMapper: mapper,
          actorId: 'system',
          now: new Date('2026-09-01T00:00:00Z'),
          where: (eb) => eb.eb('id', '=', tableId.toString()),
        });
        const statements = visitor
          .visitUpdateFormulaTimeZone(
            UpdateFormulaTimeZoneSpec.create(formulaId, undefined, TimeZone.default())
          )
          ._unsafeUnwrap();
        for (const statement of statements) await statement.execute();
        const { rows } = await pool.query('select meta from field where id = $1', [
          formulaId.toString(),
        ]);
        const savedMeta = FormulaMeta.rehydrate(JSON.parse(rows[0].meta))._unsafeUnwrap();
        expect(savedMeta.formulaSafetyVersion()._unsafeUnwrap()).toBe(scenario.expected);
        expect(savedMeta.persistedAsGeneratedColumn()._unsafeUnwrap()).toBe(
          scenario.incoming === undefined
        );
      }
    } finally {
      await db.destroy();
      await postgres.stop();
    }
  }, 60_000);
});
