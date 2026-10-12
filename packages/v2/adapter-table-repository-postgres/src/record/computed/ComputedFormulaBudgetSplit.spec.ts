import { randomUUID } from 'node:crypto';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DbFieldName,
  DbFieldType,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  RecordId,
  Table,
  TableId,
  TableName,
  domainError,
  type ILogger,
  type ITableRepository,
} from '@teable/v2-core';
import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetConfig,
  defaultFormulaCompileBudgetLimits,
  Pg16TypeValidationStrategy,
  type FormulaBudgetMetric,
  type FormulaCompileBudgetConfig,
} from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { explainUpdate } from '../query-builder/computed/plan-testkit/explain';
import { SameTableBatchQueryBuilder } from '../query-builder/computed/SameTableBatchQueryBuilder';
import type { DynamicDB } from '../query-builder/ITableRecordQueryBuilder';
import { ComputedFieldUpdater, type ComputedUpdateResult } from './ComputedFieldUpdater';
import type { ComputedUpdatePlan } from './ComputedUpdatePlanner';

const actorId = ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap();
const inputId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
const formulaId = (index: number) =>
  FieldId.create(`fld${String.fromCharCode(98 + index).repeat(16)}`)._unsafeUnwrap();
const ref = (id: FieldId) => `{${id.toString()}}`;
const recordId = (index: number) =>
  RecordId.create(`rec${String(index).padStart(16, '0')}`)._unsafeUnwrap();

const logger: ILogger = {
  child: () => logger,
  scope: () => logger,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const repository = (table: Table): ITableRepository => {
  const unused = async () =>
    err(domainError.notImplemented({ message: 'This fixture only loads its table' }));
  return {
    find: async () => ok([table]),
    findOne: async () => ok(table),
    insert: unused,
    insertMany: unused,
    updateOne: unused,
    delete: unused,
    restore: unused,
  };
};

type FormulaDefinition = { expression: string; legacy?: boolean; array?: boolean };

const makeTable = (schema: string, definitions: FormulaDefinition[]) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(schema)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Formula budget regression')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${schema}.formula_budget`)._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(inputId)
    .withName(FieldName.create('Input')._unsafeUnwrap())
    .done();
  definitions.forEach((definition, index) => {
    builder
      .field()
      .formula()
      .withId(formulaId(index))
      .withName(FieldName.create(`Formula ${index}`)._unsafeUnwrap())
      .withExpression(FormulaExpression.create(definition.expression)._unsafeUnwrap())
      .withResultType({
        cellValueType: definition.array ? CellValueType.string() : CellValueType.number(),
        isMultipleCellValue: definition.array
          ? CellValueMultiplicity.multiple()
          : CellValueMultiplicity.single(),
      })
      .done();
  });
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.getFields().forEach((field, index) => {
    field.setDbFieldName(DbFieldName.rehydrate(`col_${index}`)._unsafeUnwrap())._unsafeUnwrap();
    field
      .setDbFieldType(
        DbFieldType.rehydrate(
          index > 0 && definitions[index - 1].array ? 'jsonb' : 'double precision'
        )._unsafeUnwrap()
      )
      ._unsafeUnwrap();
    if (field instanceof FormulaField && !definitions[index - 1].legacy) {
      field.enableFormulaSafety(1)._unsafeUnwrap();
    }
  });
  return table;
};

const bounded = (metric: FormulaBudgetMetric, max: number): FormulaCompileBudgetConfig => ({
  ...defaultFormulaCompileBudgetConfig,
  policy: createFormulaCompileBudgetPolicy({ ...defaultFormulaCompileBudgetLimits, [metric]: max }),
});

// Instrument the real pure policy without replacing any compiler or database result.
const measurement = () => {
  const check = vi.fn(defaultFormulaCompileBudgetConfig.policy.check);
  return {
    config: { ...defaultFormulaCompileBudgetConfig, policy: { check } },
    maximum: (metric: FormulaBudgetMetric) =>
      Math.max(
        0,
        ...check.mock.calls.filter(([name]) => name === metric).map(([, value]) => value)
      ),
  };
};

// Compare effective event versions; preserve duplicate records/fields, version drift, and old values.
const changes = (result: ComputedUpdateResult) =>
  result.changesByStep
    .flatMap((step) =>
      step.recordChanges.map((record) => ({
        tableId: step.tableId,
        ...record,
        newVersion: record.newVersion ?? record.oldVersion + 1,
        changes: [...record.changes].sort((a, b) => a.fieldId.localeCompare(b.fieldId)),
      }))
    )
    .sort((a, b) => a.recordId.localeCompare(b.recordId));

for (const backend of ['pglite', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !process.env.FORMULA_PLAN_DATABASE_URL)(
    `formula budget splitting on ${backend}${backend === 'postgres' ? ' (requires FORMULA_PLAN_DATABASE_URL)' : ''}`,
    () => {
      let db: Kysely<V1TeableDatabase>;
      const schema = `bse${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const physicalTable = `${schema}.formula_budget`;

      beforeAll(async () => {
        db =
          backend === 'pglite'
            ? (await createPGliteDb()).db
            : await createV2PostgresDb<V1TeableDatabase>({
                pg: {
                  connectionString: process.env.FORMULA_PLAN_DATABASE_URL!,
                  pool: { max: 1, connectionTimeoutMillis: 5000 },
                },
              });
        await sql`SET statement_timeout = '15s'`.execute(db);
        await sql`SET lock_timeout = '2s'`.execute(db);
        await sql`SET jit = off`.execute(db);
        await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
      });

      afterAll(async () => {
        if (!db) return;
        try {
          await sql`DROP SCHEMA IF EXISTS ${sql.id(schema)} CASCADE`.execute(db);
        } finally {
          await db.destroy();
        }
      });

      const fixture = async (definitions: FormulaDefinition[], count = 4) => {
        const table = makeTable(schema, definitions);
        const rows = Array.from({ length: count + 1 }, (_, index) => ({
          __id: recordId(index).toString(),
          __version: 10,
          col_0: index + 1,
          ...Object.fromEntries(
            definitions.map((definition, field) => [
              `col_${field + 1}`,
              definition.array ? JSON.stringify(['old']) : -100 - field,
            ])
          ),
        }));
        await sql`DROP TABLE IF EXISTS ${sql.table(physicalTable)}`.execute(db);
        await sql`CREATE TABLE ${sql.table(physicalTable)} (
          __id text PRIMARY KEY, __version integer NOT NULL, col_0 double precision,
          ${sql.join(
            definitions.map(
              (definition, index) =>
                sql`${sql.id(`col_${index + 1}`)} ${sql.raw(definition.array ? 'jsonb' : 'double precision')}`
            )
          )}
        )`.execute(db);
        const reset = async (target: Kysely<V1TeableDatabase> = db) => {
          await sql`TRUNCATE ${sql.table(physicalTable)}`.execute(target);
          await (target as unknown as Kysely<DynamicDB>)
            .insertInto(physicalTable)
            .values(rows)
            .execute();
        };
        const plan = (
          levels = [definitions.map((_, index) => index)],
          records = count
        ): ComputedUpdatePlan => ({
          baseId: table.baseId(),
          seedTableId: table.id(),
          seedRecordIds: Array.from({ length: records }, (_, index) => recordId(index)),
          extraSeedRecords: [],
          steps: levels.map((fields, level) => ({
            tableId: table.id(),
            fieldIds: fields.map(formulaId),
            level,
          })),
          edges: [],
          estimatedComplexity: definitions.length,
          changeType: 'update',
          changedFieldIds: [inputId],
          sameTableBatches: [],
        });
        const run = async (
          config = defaultFormulaCompileBudgetConfig,
          selectedPlan = plan(),
          planName?: string
        ) => {
          await reset();
          const execution = await db.transaction().execute(async (trx) => {
            const submitted = vi.spyOn(trx, 'executeQuery');
            const updater = new ComputedFieldUpdater(
              repository(table),
              logger,
              trx,
              undefined,
              new Pg16TypeValidationStrategy(),
              undefined,
              config
            );
            let result: ComputedUpdateResult;
            let updates: CompiledQuery[];
            try {
              result = (
                await updater.execute(selectedPlan, { actorId }, undefined, {
                  collectChanges: true,
                  isolateOversizedComputedCells: true,
                })
              )._unsafeUnwrap({ withStackTrace: true });
              updates = submitted.mock.calls
                .map(([query]) => query)
                .filter((query) => query.sql.includes(`update "${schema}"."formula_budget"`));
            } finally {
              submitted.mockRestore();
            }
            if (backend === 'postgres' && planName) {
              // EXPLAIN ANALYZE executes the actual accepted statement against old data.
              // Roll it back independently so neither versions nor acceptance rows are changed twice.
              for (const [index, query] of updates.entries()) {
                await sql`SAVEPOINT formula_plan_probe`.execute(trx);
                try {
                  await reset(trx);
                  const evidence = await explainUpdate(
                    trx,
                    query,
                    `${planName}-${schema}-${index}`
                  );
                  expect(Number.isFinite(evidence.document['Planning Time'])).toBe(true);
                  expect(Number.isFinite(evidence.document['Execution Time'])).toBe(true);
                } finally {
                  await sql`ROLLBACK TO SAVEPOINT formula_plan_probe`.execute(trx);
                  await sql`RELEASE SAVEPOINT formula_plan_probe`.execute(trx);
                }
              }
            }
            return { result, updates };
          });
          const stored = await sql<
            Record<string, unknown>
          >`SELECT * FROM ${sql.table(physicalTable)} ORDER BY __id`.execute(db);
          return { ...execution, rows: stored.rows };
        };
        return { table, plan, run };
      };

      it('splits individually legal fields without changing stored values, versions, dirty scope or event-source changes', async () => {
        const data = await fixture([
          { expression: `${ref(inputId)} + 10` },
          { expression: `${ref(inputId)} * 7` },
          { expression: `${ref(inputId)} - 3` },
        ]);
        const singles = measurement();
        for (let index = 0; index < 3; index++)
          await data.run(singles.config, data.plan([[index]]));
        const max = singles.maximum('uniqueNodes');
        const normalMeter = measurement();
        const normal = await data.run(normalMeter.config, data.plan(), 'budget-normal');
        expect(normalMeter.maximum('uniqueNodes')).toBeGreaterThan(max);
        expect(normal.updates).toHaveLength(1);
        const split = await data.run(
          bounded('uniqueNodes', max),
          data.plan(),
          'budget-field-split'
        );
        expect(split.updates.length).toBeGreaterThan(1);
        expect(split.result.fieldErrors ?? []).toEqual([]);
        expect(split.rows).toEqual(normal.rows);
        expect(changes(split.result)).toEqual(changes(normal.result));
        expect(normal.rows).toEqual(
          Array.from({ length: 5 }, (_, index) => ({
            __id: recordId(index).toString(),
            __version: index < 4 ? 11 : 10,
            col_0: index + 1,
            col_1: index < 4 ? index + 11 : -100,
            col_2: index < 4 ? (index + 1) * 7 : -101,
            col_3: index < 4 ? index - 2 : -102,
          }))
        );
        expect(changes(split.result).map((record) => record.oldVersion)).toEqual([10, 10, 10, 10]);
        expect(changes(split.result).map((record) => record.newVersion)).toEqual([11, 11, 11, 11]);
      });

      it('rejects mixed explicit compiler roots but executes legacy and protected updater groups without a downgrade', async () => {
        const large = `${ref(inputId)}${' + 1'.repeat(16)}`;
        const data = await fixture([
          { expression: large, legacy: true },
          { expression: large },
          { expression: `${ref(inputId)} + 1` },
        ]);
        const meter = measurement();
        await data.run(meter.config, data.plan([[2]]));
        const config = bounded('uniqueNodes', meter.maximum('uniqueNodes'));
        const mixed = new SameTableBatchQueryBuilder(
          db as unknown as Kysely<DynamicDB>,
          new Pg16TypeValidationStrategy(),
          config
        ).build({
          table: data.table,
          fieldLevels: [{ level: 0, fieldIds: [formulaId(0), formulaId(1)] }],
        });
        expect(mixed.isErr()).toBe(true);
        if (mixed.isErr()) expect(mixed.error.tags).toContain('invariant');
        const result = await data.run(config);
        expect(result.result.fieldErrors?.map((entry) => entry.fieldId)).toEqual([
          formulaId(1).toString(),
        ]);
        expect(result.rows.slice(0, 4).map((row) => [row.col_1, row.col_2, row.col_3])).toEqual([
          [17, -101, 2],
          [18, -101, 3],
          [19, -101, 4],
          [20, -101, 5],
        ]);
        expect(
          changes(result.result).flatMap((record) => record.changes.map((change) => change.fieldId))
        ).not.toContain(formulaId(1).toString());
      });

      it('budgets legacy dependencies expanded to preserve error-state semantics', async () => {
        const data = await fixture([
          { expression: `${ref(inputId)}${' + 1'.repeat(16)}`, legacy: true },
          { expression: `IF(IS_ERROR(${ref(formulaId(0))}), 0, ${ref(formulaId(0))} + 1)` },
          { expression: `IF(IS_ERROR(${ref(inputId)}), 0, ${ref(inputId)} + 1)` },
        ]);
        const meter = measurement();
        await data.run(meter.config, data.plan([[2]]));
        const result = await data.run(
          bounded('uniqueNodes', meter.maximum('uniqueNodes')),
          data.plan([[1]])
        );
        expect(result.updates).toEqual([]);
        expect(changes(result.result)).toEqual([]);
        expect(result.result.fieldErrors).toMatchObject([
          {
            fieldId: formulaId(1).toString(),
            error: { code: 'validation.limit.formula_compile_nodes_max' },
          },
        ]);
        expect(result.rows.map((row) => [row.__version, row.col_1, row.col_2, row.col_3])).toEqual(
          Array.from({ length: 5 }, () => [10, -100, -101, -102])
        );
      });

      it('keeps an oversized root and its dependent unresolved while an independent sibling commits', async () => {
        const data = await fixture([
          { expression: `${ref(inputId)}${' + 1'.repeat(16)}` },
          { expression: `${ref(inputId)} * 2` },
          { expression: `${ref(formulaId(0))} + 1` },
        ]);
        const meter = measurement();
        await data.run(meter.config, data.plan([[1]]));
        const result = await data.run(
          bounded('uniqueNodes', meter.maximum('uniqueNodes')),
          data.plan([[0, 1], [2]])
        );
        expect(result.result.fieldErrors?.map((entry) => entry.fieldId).sort()).toEqual(
          [formulaId(0).toString(), formulaId(2).toString()].sort()
        );
        expect(
          result.rows.slice(0, 4).map((row) => [row.__version, row.col_1, row.col_2, row.col_3])
        ).toEqual([
          [11, -100, 2, -102],
          [11, -100, 4, -102],
          [11, -100, 6, -102],
          [11, -100, 8, -102],
        ]);
        expect(changes(result.result).map((record) => record.changes)).toEqual(
          [2, 4, 6, 8].map((newValue) => [
            { fieldId: formulaId(1).toString(), oldValue: -101, newValue },
          ])
        );
      });

      it('does not submit an UPDATE or change any version when a single protected formula cannot fit', async () => {
        const data = await fixture([{ expression: `${ref(inputId)} + 1` }]);
        const result = await data.run(bounded('uniqueNodes', 0));
        expect(result.updates).toEqual([]);
        expect(changes(result.result)).toEqual([]);
        expect(result.result.fieldErrors).toMatchObject([
          {
            fieldId: formulaId(0).toString(),
            error: { code: 'validation.limit.formula_compile_nodes_max' },
          },
        ]);
        expect(result.rows).toEqual(
          Array.from({ length: 5 }, (_, index) => ({
            __id: recordId(index).toString(),
            __version: 10,
            col_0: index + 1,
            col_1: -100,
          }))
        );
      });

      it('splits record parameters after a singleton fits the complete UPDATE budget', async () => {
        const data = await fixture(
          [{ expression: 'TEXTSPLIT("alpha:beta", ":")', array: true }],
          8
        );
        const singleMeter = measurement();
        const single = await data.run(singleMeter.config, data.plan([[0]], 1));
        expect(single.updates).toHaveLength(1);
        const max = singleMeter.maximum('sqlBytes');
        const normalMeter = measurement();
        const normal = await data.run(normalMeter.config);
        expect(normal.updates).toHaveLength(1);
        expect(normalMeter.maximum('sqlBytes')).toBeGreaterThan(max);
        const split = await data.run(bounded('sqlBytes', max), data.plan(), 'budget-record-split');
        expect(split.result.fieldErrors ?? []).toEqual([]);
        expect(split.updates.length).toBeGreaterThan(1);
        for (const query of split.updates)
          expect(Buffer.byteLength(query.sql, 'utf8')).toBeLessThanOrEqual(max);
        expect(split.rows).toEqual(normal.rows);
        expect(changes(split.result)).toEqual(changes(normal.result));
        expect(split.rows.map((row) => [row.__version, row.col_1])).toEqual([
          ...Array.from({ length: 8 }, () => [11, ['alpha', 'beta']]),
          [10, ['old']],
        ]);
      });
    }
  );
}
