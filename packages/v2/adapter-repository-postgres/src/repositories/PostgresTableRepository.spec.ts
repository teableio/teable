/* eslint-disable @typescript-eslint/naming-convention */
import type {
  AttachmentField,
  AutoNumberField,
  ButtonField,
  CheckboxField,
  ConditionalLookupField,
  ConditionalRollupField,
  CreatedByField,
  CreatedTimeField,
  DateField,
  FormulaField,
  IFieldVisitor,
  ITableRepository,
  IUnitOfWorkTransaction,
  LastModifiedByField,
  LastModifiedTimeField,
  LinkField,
  LongTextField,
  LookupField,
  MultipleSelectField,
  NumberField,
  RatingField,
  RollupField,
  SingleLineTextField,
  SingleSelectField,
  UserField,
} from '@teable/v2-core';
import {
  ActorId,
  BaseId,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FieldNotNull,
  FieldUnique,
  FormulaExpression,
  getRandomString,
  LinkFieldConfig,
  LookupOptions,
  OffsetPagination,
  PageLimit,
  PageOffset,
  RatingColor,
  RatingIcon,
  RatingMax,
  resolveFormulaFields,
  RollupExpression,
  RollupFieldConfig,
  SelectOption,
  Sort,
  SortDirection,
  Table,
  TableName,
  TableByNameSpec,
  TableByIdSpec,
  TableId,
  TableUpdateFieldNameSpec,
  TableUpdateViewColumnMetaSpec,
  TableSortKey,
  ViewColumnMeta,
  ViewId,
  ViewName,
  createSingleSelectField,
  v2CoreTokens,
  domainError,
} from '@teable/v2-core';
import { container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { err, ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type StartedPostgreSqlContainer = Awaited<ReturnType<PostgreSqlContainer['start']>>;

import { registerV2PostgresStateAdapter } from '../di/register';
import { convertNameToValidCharacter, joinDbTableName } from '../naming';

const createPgDb = async (connectionString: string): Promise<Kysely<V1TeableDatabase>> => {
  const pg = (await import('pg')) as typeof import('pg') & { default?: typeof import('pg') };
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (!Pool) {
    throw new Error('Missing pg.Pool');
  }

  return new Kysely<V1TeableDatabase>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
};

type IFieldSnapshot =
  | { type: 'singleLineText'; name: string }
  | { type: 'longText'; name: string }
  | { type: 'number'; name: string }
  | { type: 'rating'; name: string; max: number; icon: string; color: string }
  | { type: 'singleSelect'; name: string; options: ReadonlyArray<{ name: string; color: string }> }
  | {
      type: 'multipleSelect';
      name: string;
      options: ReadonlyArray<{ name: string; color: string }>;
    }
  | { type: 'checkbox'; name: string }
  | { type: 'attachment'; name: string }
  | { type: 'date'; name: string }
  | { type: 'createdTime'; name: string }
  | { type: 'lastModifiedTime'; name: string }
  | { type: 'user'; name: string }
  | { type: 'createdBy'; name: string }
  | { type: 'lastModifiedBy'; name: string }
  | { type: 'autoNumber'; name: string }
  | { type: 'button'; name: string }
  | { type: 'formula'; name: string; expression: string }
  | { type: 'rollup'; name: string; expression: string }
  | { type: 'conditionalRollup'; name: string; expression: string }
  | { type: 'conditionalLookup'; name: string };

class FieldToSnapshotVisitor implements IFieldVisitor<IFieldSnapshot> {
  visitSingleLineTextField(field: SingleLineTextField) {
    const snapshot: IFieldSnapshot = { type: 'singleLineText', name: field.name().toString() };
    return ok(snapshot);
  }

  visitLongTextField(field: LongTextField) {
    const snapshot: IFieldSnapshot = { type: 'longText', name: field.name().toString() };
    return ok(snapshot);
  }

  visitNumberField(field: NumberField) {
    const snapshot: IFieldSnapshot = { type: 'number', name: field.name().toString() };
    return ok(snapshot);
  }

  visitRatingField(field: RatingField) {
    const snapshot: IFieldSnapshot = {
      type: 'rating',
      name: field.name().toString(),
      max: field.ratingMax().toNumber(),
      icon: field.ratingIcon().toString(),
      color: field.ratingColor().toString(),
    };
    return ok(snapshot);
  }

  visitFormulaField(field: FormulaField) {
    const snapshot: IFieldSnapshot = {
      type: 'formula',
      name: field.name().toString(),
      expression: field.expression().toString(),
    };
    return ok(snapshot);
  }

  visitRollupField(field: RollupField) {
    const snapshot: IFieldSnapshot = {
      type: 'rollup',
      name: field.name().toString(),
      expression: field.expression().toString(),
    };
    return ok(snapshot);
  }

  visitSingleSelectField(field: SingleSelectField) {
    const snapshot: IFieldSnapshot = {
      type: 'singleSelect',
      name: field.name().toString(),
      options: field.selectOptions().map((o) => ({
        name: o.name().toString(),
        color: o.color().toString(),
      })),
    };
    return ok(snapshot);
  }

  visitMultipleSelectField(field: MultipleSelectField) {
    const snapshot: IFieldSnapshot = {
      type: 'multipleSelect',
      name: field.name().toString(),
      options: field.selectOptions().map((o) => ({
        name: o.name().toString(),
        color: o.color().toString(),
      })),
    };
    return ok(snapshot);
  }

  visitCheckboxField(field: CheckboxField) {
    const snapshot: IFieldSnapshot = { type: 'checkbox', name: field.name().toString() };
    return ok(snapshot);
  }

  visitAttachmentField(field: AttachmentField) {
    const snapshot: IFieldSnapshot = { type: 'attachment', name: field.name().toString() };
    return ok(snapshot);
  }

  visitDateField(field: DateField) {
    const snapshot: IFieldSnapshot = { type: 'date', name: field.name().toString() };
    return ok(snapshot);
  }

  visitCreatedTimeField(field: CreatedTimeField) {
    const snapshot: IFieldSnapshot = { type: 'createdTime', name: field.name().toString() };
    return ok(snapshot);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField) {
    const snapshot: IFieldSnapshot = {
      type: 'lastModifiedTime',
      name: field.name().toString(),
    };
    return ok(snapshot);
  }

  visitUserField(field: UserField) {
    const snapshot: IFieldSnapshot = { type: 'user', name: field.name().toString() };
    return ok(snapshot);
  }

  visitCreatedByField(field: CreatedByField) {
    const snapshot: IFieldSnapshot = { type: 'createdBy', name: field.name().toString() };
    return ok(snapshot);
  }

  visitLastModifiedByField(field: LastModifiedByField) {
    const snapshot: IFieldSnapshot = { type: 'lastModifiedBy', name: field.name().toString() };
    return ok(snapshot);
  }

  visitAutoNumberField(field: AutoNumberField) {
    const snapshot: IFieldSnapshot = { type: 'autoNumber', name: field.name().toString() };
    return ok(snapshot);
  }

  visitButtonField(field: ButtonField) {
    const snapshot: IFieldSnapshot = { type: 'button', name: field.name().toString() };
    return ok(snapshot);
  }

  visitLinkField(_: LinkField) {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }

  visitLookupField(_: LookupField) {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }

  visitConditionalRollupField(field: ConditionalRollupField) {
    const snapshot: IFieldSnapshot = {
      type: 'conditionalRollup',
      name: field.name().toString(),
      expression: field.expression().toString(),
    };
    return ok(snapshot);
  }

  visitConditionalLookupField(field: ConditionalLookupField) {
    const snapshot: IFieldSnapshot = {
      type: 'conditionalLookup',
      name: field.name().toString(),
    };
    return ok(snapshot);
  }
}

describe('PostgresTableRepository (pg)', () => {
  let pgContainer: StartedPostgreSqlContainer;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('teable_v2_test')
      .withUsername('teable')
      .withPassword('teable')
      .start();
  });

  afterAll(async () => {
    await pgContainer.stop();
  });

  it('saves and loads a table by specs', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
      baseIdResult._unsafeUnwrap();

      const baseId = baseIdResult._unsafeUnwrap();
      const spaceId = `spc${getRandomString(16)}`;
      const actorIdResult = ActorId.create('system');
      actorIdResult._unsafeUnwrap();

      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableNameResult = TableName.create('Projects');
      const titleNameResult = FieldName.create('Name');
      const priorityNameResult = FieldName.create('Priority');
      const scoreNameResult = FieldName.create('Score');
      const statusNameResult = FieldName.create('Status');
      [
        tableNameResult,
        titleNameResult,
        priorityNameResult,
        scoreNameResult,
        statusNameResult,
      ].forEach((r) => r._unsafeUnwrap());
      tableNameResult._unsafeUnwrap();
      titleNameResult._unsafeUnwrap();
      priorityNameResult._unsafeUnwrap();
      scoreNameResult._unsafeUnwrap();
      statusNameResult._unsafeUnwrap();

      const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
      const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
      const iconResult = RatingIcon.create('moon');
      const colorResult = RatingColor.create('redBright');
      [todoOptionResult, doneOptionResult, iconResult, colorResult].forEach((r) =>
        r._unsafeUnwrap()
      );
      todoOptionResult._unsafeUnwrap();
      doneOptionResult._unsafeUnwrap();
      iconResult._unsafeUnwrap();
      colorResult._unsafeUnwrap();

      const priorityId = FieldId.create(`fld${'b'.repeat(16)}`);
      priorityId._unsafeUnwrap();

      const formulaExpression = FormulaExpression.create(
        `{${priorityId._unsafeUnwrap().toString()}} + 1`
      );
      formulaExpression._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableNameResult._unsafeUnwrap());
      builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).done();
      builder
        .field()
        .rating()
        .withName(priorityNameResult._unsafeUnwrap())
        .withId(priorityId._unsafeUnwrap())
        .withMax(RatingMax.five())
        .withIcon(iconResult._unsafeUnwrap())
        .withColor(colorResult._unsafeUnwrap())
        .primary()
        .done();
      builder
        .field()
        .formula()
        .withName(scoreNameResult._unsafeUnwrap())
        .withExpression(formulaExpression._unsafeUnwrap())
        .done();
      builder
        .field()
        .singleSelect()
        .withName(statusNameResult._unsafeUnwrap())
        .withOptions([todoOptionResult._unsafeUnwrap(), doneOptionResult._unsafeUnwrap()])
        .done();
      builder.view().defaultGrid().done();
      builder.view().kanban().defaultName().done();

      const tableResult = builder.build();
      tableResult._unsafeUnwrap();

      const table = tableResult._unsafeUnwrap();
      const resolveResult = resolveFormulaFields(table);
      resolveResult._unsafeUnwrap();

      expect(table.primaryFieldId().equals(table.getFields()[1].id())).toBe(true);

      const insertResult = await repo.insert(context, table);
      insertResult._unsafeUnwrap();

      const persistedTable = insertResult._unsafeUnwrap();

      const persistedFields = await db
        .selectFrom('field')
        .select(['id', 'is_primary'])
        .where('table_id', '=', table.id().toString())
        .where('deleted_time', 'is', null)
        .execute();
      expect(persistedFields.filter((f) => f.is_primary === true)).toHaveLength(1);
      expect(persistedFields.find((f) => f.is_primary === true)?.id).toBe(
        table.primaryFieldId().toString()
      );

      const expectedDbTableName = joinDbTableName(baseId.toString(), table.id().toString());
      const dbTableNameResult = persistedTable.dbTableName().andThen((name) => name.value());

      expect(dbTableNameResult._unsafeUnwrap()).toBe(expectedDbTableName);

      const tableMetaRow = await db
        .selectFrom('table_meta')
        .select(['db_table_name', 'base_id'])
        .where('id', '=', table.id().toString())
        .executeTakeFirst();
      expect(tableMetaRow?.db_table_name).toBe(expectedDbTableName);
      expect(tableMetaRow?.base_id).toBe(baseId.toString());

      const expectedDbFieldNames = table
        .getFields()
        .map((field) => convertNameToValidCharacter(field.name().toString(), 40));
      const dbFieldNameResults = persistedTable
        .getFields()
        .map((field) => field.dbFieldName().andThen((name) => name.value()));
      expect(dbFieldNameResults.map((result) => result._unsafeUnwrap())).toEqual(
        expectedDbFieldNames
      );

      const dbFieldRows = await db
        .selectFrom('field')
        .select(['db_field_name'])
        .where('table_id', '=', table.id().toString())
        .where('deleted_time', 'is', null)
        .orderBy('order')
        .execute();
      expect(dbFieldRows.map((row) => row.db_field_name)).toEqual(expectedDbFieldNames);

      const byIdSpecResult = table.specs().byId(table.id()).build();

      const byIdResult = await repo.findOne(context, byIdSpecResult._unsafeUnwrap());

      const loaded = byIdResult._unsafeUnwrap();
      expect(loaded.id().toString()).toBe(table.id().toString());
      expect(loaded.name().toString()).toBe(table.name().toString());
      expect(loaded.primaryFieldId().equals(table.primaryFieldId())).toBe(true);
      const loadedDbTableNameResult = loaded.dbTableName().andThen((name) => name.value());

      expect(loadedDbTableNameResult._unsafeUnwrap()).toBe(expectedDbTableName);
      expect(
        loaded.views().map((v) => ({ name: v.name().toString(), type: v.type().toString() }))
      ).toEqual([
        { name: 'Grid', type: 'grid' },
        { name: 'Kanban', type: 'kanban' },
      ]);

      const primaryOnly = (
        await repo.findOne(
          context,
          table.specs().byId(table.id()).withPrimaryField().build()._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      expect(primaryOnly.getFields()).toHaveLength(1);
      expect(primaryOnly.getFields()[0]!.id().equals(table.primaryFieldId())).toBe(true);
      expect(primaryOnly.views()).toHaveLength(table.views().length);

      const targetView = table.views()[1];
      const selectiveSpec = table
        .specs()
        .byId(table.id())
        .withViewId(targetView.id())
        .build()
        ._unsafeUnwrap();
      const selectivelyLoaded = (await repo.findOne(context, selectiveSpec))._unsafeUnwrap();

      expect(selectivelyLoaded.id().equals(table.id())).toBe(true);
      expect(selectivelyLoaded.getFields()).toHaveLength(table.getFields().length);
      expect(selectivelyLoaded.views()).toHaveLength(1);
      expect(selectivelyLoaded.views()[0].id().equals(targetView.id())).toBe(true);
      expect(selectivelyLoaded.views()[0].type().toString()).toBe('kanban');
      expect(selectivelyLoaded.views()[0].version()._unsafeUnwrap().toNumber()).toBe(1);
      expect(selectivelyLoaded.views()[0].auditMetadata()._unsafeUnwrap().toDto()).toMatchObject({
        createdBy: actorId.toString(),
        createdTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });

      const projectedViewIdsSpec = table
        .specs()
        .byId(table.id())
        .withViewIds([targetView.id(), ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap()])
        .build()
        ._unsafeUnwrap();
      const projectedViews = (await repo.findOne(context, projectedViewIdsSpec))._unsafeUnwrap();

      expect(projectedViews.id().equals(table.id())).toBe(true);
      expect(projectedViews.views().map((view) => view.id().toString())).toEqual([
        targetView.id().toString(),
      ]);

      const snapshotVisitor: IFieldVisitor<IFieldSnapshot> = new FieldToSnapshotVisitor();
      const fieldSnapshots = loaded.getFields().map((f) => f.accept(snapshotVisitor));
      fieldSnapshots.forEach((r) => r._unsafeUnwrap());
      fieldSnapshots.forEach((r) => r._unsafeUnwrap());

      expect(fieldSnapshots.map((r) => r._unsafeUnwrap())).toEqual<IFieldSnapshot[]>([
        { type: 'rating', name: 'Priority', max: 5, icon: 'moon', color: 'redBright' },
        { type: 'singleLineText', name: 'Name' },
        {
          type: 'formula',
          name: 'Score',
          expression: `{${priorityId._unsafeUnwrap().toString()}} + 1`,
        },
        {
          type: 'singleSelect',
          name: 'Status',
          options: [
            { name: 'Todo', color: 'blue' },
            { name: 'Done', color: 'red' },
          ],
        },
      ]);

      const byNameSpecResult = table.specs().byName(table.name()).build();
      byNameSpecResult._unsafeUnwrap();

      const byNameResult = await repo.findOne(context, byNameSpecResult._unsafeUnwrap());
      byNameResult._unsafeUnwrap();
    } finally {
      await db.destroy();
    }
  });

  it('records schema operation state when table provision state changes', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${getRandomString(16)}`)._unsafeUnwrap();
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId, requestId: 'req-schema-operation-test' };

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Schema Operation Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Schema Operation Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Schema Operation Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const persistedTable = (await repo.insert(context, table))._unsafeUnwrap();

      const pendingResult = await repo.setProvisionState!(context, persistedTable, 'pending', {
        operationType: 'table.create',
        phase: 'metadata_pending',
        payload: { source: 'test' },
      });
      pendingResult._unsafeUnwrap();

      const readyResult = await repo.setProvisionState!(context, persistedTable, 'ready', {
        operationType: 'table.create',
        phase: 'ready',
      });
      readyResult._unsafeUnwrap();

      const rows = await db
        .selectFrom('schema_operation')
        .select([
          'type',
          'status',
          'phase',
          'resource_type',
          'resource_id',
          'base_id',
          'table_id',
          'idempotency_key',
          'payload',
          'attempts',
        ])
        .where('resource_id', '=', persistedTable.id().toString())
        .execute();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        type: 'table.create',
        status: 'ready',
        phase: 'ready',
        resource_type: 'table',
        resource_id: persistedTable.id().toString(),
        base_id: baseId.toString(),
        table_id: persistedTable.id().toString(),
        idempotency_key: `req-schema-operation-test:table:${persistedTable.id().toString()}`,
        payload: { source: 'test' },
        attempts: 0,
      });
    } finally {
      await db.destroy();
    }
  });

  it('writes a trash row in the same transaction as a soft delete', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${getRandomString(16)}`)._unsafeUnwrap();
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Trash Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Trash Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Trash Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = (await repo.insert(context, builder.build()._unsafeUnwrap()))._unsafeUnwrap();

      (await repo.delete(context, table))._unsafeUnwrap();

      const trashRows = await sql<{
        resource_id: string;
        resource_type: string;
        parent_id: string;
        deleted_by: string;
      }>`
        SELECT resource_id, resource_type, parent_id, deleted_by
        FROM trash
        WHERE resource_id = ${table.id().toString()}
      `.execute(db);

      expect(trashRows.rows).toEqual([
        {
          resource_id: table.id().toString(),
          resource_type: 'table',
          parent_id: baseId.toString(),
          deleted_by: actorId.toString(),
        },
      ]);
    } finally {
      await db.destroy();
    }
  });

  it('waits for a pending table to become ready instead of reporting not found', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    const previousWait = process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
    const previousPoll = process.env.V2_TABLE_PROVISION_READY_POLL_MS;
    process.env.V2_TABLE_PROVISION_READY_WAIT_MS = '2000';
    process.env.V2_TABLE_PROVISION_READY_POLL_MS = '25';

    try {
      const baseId = BaseId.create(`bse${getRandomString(16)}`)._unsafeUnwrap();
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId, requestId: 'req-provision-wait-test' };

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Provision Wait Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Provision Wait Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Provision Wait Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const persistedTable = (await repo.insert(context, table))._unsafeUnwrap();
      const tableId = persistedTable.id().toString();

      const setProvisionState = async (state: 'pending' | 'ready') => {
        await db
          .updateTable('table_meta')
          .set({ provision_state: state })
          .where('id', '=', tableId)
          .execute();
      };

      // A read landing inside a concurrent schema update's pending window must
      // wait for the ready flip instead of failing with table.not_found.
      await setProvisionState('pending');
      const flipToReady = setTimeout(() => {
        void setProvisionState('ready');
      }, 150);
      const foundResult = await repo.findOne(context, TableByIdSpec.create(persistedTable.id()));
      clearTimeout(flipToReady);
      expect(foundResult.isOk()).toBe(true);
      expect(foundResult._unsafeUnwrap().id().toString()).toBe(tableId);

      // A table that never becomes ready still reports not found, but only
      // after the bounded wait — it is indistinguishable from a slow schema
      // update until the budget expires.
      await setProvisionState('pending');
      const startedAt = Date.now();
      const stuckResult = await repo.findOne(context, TableByIdSpec.create(persistedTable.id()));
      expect(stuckResult.isErr()).toBe(true);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
      // A stuck table must be distinguishable from a genuinely missing one in
      // logs: the not-found error carries the exhausted provisioning wait.
      expect(stuckResult._unsafeUnwrapErr().message).toContain('provision_state=pending after');
      await setProvisionState('ready');
    } finally {
      if (previousWait == null) {
        delete process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
      } else {
        process.env.V2_TABLE_PROVISION_READY_WAIT_MS = previousWait;
      }
      if (previousPoll == null) {
        delete process.env.V2_TABLE_PROVISION_READY_POLL_MS;
      } else {
        process.env.V2_TABLE_PROVISION_READY_POLL_MS = previousPoll;
      }
      await db.destroy();
    }
  });

  it('fails fast on a pending table inside an active transaction instead of sleeping', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    const previousWait = process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
    process.env.V2_TABLE_PROVISION_READY_WAIT_MS = '5000';

    try {
      const baseId = BaseId.create(`bse${getRandomString(16)}`)._unsafeUnwrap();
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId, requestId: 'req-provision-tx-test' };

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Provision Tx Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Provision Tx Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Provision Tx Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const persistedTable = (await repo.insert(context, table))._unsafeUnwrap();
      const tableId = persistedTable.id().toString();

      await db
        .updateTable('table_meta')
        .set({ provision_state: 'pending' })
        .where('id', '=', tableId)
        .execute();

      // Waiting inside a transaction would park its connection (and any locks
      // it holds) for the whole budget; transactional callers must keep the
      // original fail-fast not-found behavior.
      await db.transaction().execute(async (trx) => {
        const transaction = {
          kind: 'unitOfWorkTransaction',
          scope: 'meta',
          pending: true,
          db: trx,
        } as IUnitOfWorkTransaction;
        const txContext = { actorId, requestId: 'req-provision-tx-test', transaction };
        const startedAt = Date.now();
        const txResult = await repo.findOne(txContext, TableByIdSpec.create(persistedTable.id()));
        expect(txResult.isErr()).toBe(true);
        expect(txResult._unsafeUnwrapErr().code).toBe('table.provision_pending');
        expect(txResult._unsafeUnwrapErr().message).toContain('provision_state=pending');
        expect(Date.now() - startedAt).toBeLessThan(1000);
      });

      await db
        .updateTable('table_meta')
        .set({ provision_state: 'ready' })
        .where('id', '=', tableId)
        .execute();
    } finally {
      if (previousWait == null) {
        delete process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
      } else {
        process.env.V2_TABLE_PROVISION_READY_WAIT_MS = previousWait;
      }
      await db.destroy();
    }
  });

  it('reloads once when the table turns ready between the missed read and the probe', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${getRandomString(16)}`)._unsafeUnwrap();
      const spaceId = `spc${getRandomString(16)}`;
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId, requestId: 'req-provision-ready-race-test' };

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Provision Race Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Provision Race Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Provision Race Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const persistedTable = (await repo.insert(context, table))._unsafeUnwrap();
      const tableId = persistedTable.id().toString();

      // White-box: drive loadActiveTableRow with a loader that misses once
      // while the row is already 'ready' in table_meta. That models the ready
      // flip landing between the missed load and the provision-state probe —
      // the loader must be retried once instead of reporting not-found.
      type LoadActiveTableRow = (
        context: { actorId: ActorId; requestId?: string },
        spec: unknown,
        options: undefined,
        loadRow: () => Promise<{ id: string } | undefined>,
        effectiveState: 'active'
      ) => Promise<{ row: { id: string } | undefined; pendingWaitExpiredMs?: number }>;
      const loadActiveTableRow = (
        repo as unknown as { loadActiveTableRow: LoadActiveTableRow }
      ).loadActiveTableRow.bind(repo);

      let loads = 0;
      const raceResult = await loadActiveTableRow(
        context,
        TableByIdSpec.create(persistedTable.id()),
        undefined,
        async () => {
          loads += 1;
          return loads === 1 ? undefined : { id: tableId };
        },
        'active'
      );
      expect(raceResult.row).toEqual({ id: tableId });
      expect(loads).toBe(2);

      // A genuinely missing table still fails on the first miss: the probe
      // finds no ready/pending row, so the loader is not retried.
      loads = 0;
      const missingId = TableId.create(`tbl${getRandomString(16)}`)._unsafeUnwrap();
      const missingResult = await loadActiveTableRow(
        context,
        TableByIdSpec.create(missingId),
        undefined,
        async () => {
          loads += 1;
          return undefined;
        },
        'active'
      );
      expect(missingResult.row).toBeUndefined();
      expect(missingResult.pendingWaitExpiredMs).toBeUndefined();
      expect(loads).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it('hydrates fields in the same fallback visible order as the field list API', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('Selection Column Order')._unsafeUnwrap();
      const statusName = FieldName.create('Status')._unsafeUnwrap();
      const assigneeName = FieldName.create('Assignee')._unsafeUnwrap();
      const titleName = FieldName.create('Title')._unsafeUnwrap();
      const todoOption = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleSelect().withName(statusName).withOptions([todoOption]).done();
      builder.field().user().withName(assigneeName).done();
      builder.field().singleLineText().withName(titleName).primary().done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      const insertResult = await repo.insert(context, table);
      insertResult._unsafeUnwrap();

      const primaryFieldId = table.primaryFieldId().toString();
      const statusFieldId = table
        .getFields()
        .find((field) => field.name().equals(statusName))
        ?.id()
        .toString();
      const assigneeFieldId = table
        .getFields()
        .find((field) => field.name().equals(assigneeName))
        ?.id()
        .toString();

      expect(statusFieldId).toBeDefined();
      expect(assigneeFieldId).toBeDefined();

      await db
        .updateTable('field')
        .set({ is_primary: null })
        .where('table_id', '=', table.id().toString())
        .where('id', '!=', primaryFieldId)
        .execute();

      const loaded = await repo
        .findOne(context, table.specs().byId(table.id()).build()._unsafeUnwrap())
        .then((result) => result._unsafeUnwrap());

      const viewId = loaded.views()[0]?.id().toString();
      expect(viewId).toBeDefined();

      const orderedVisibleFieldIds = loaded
        .getOrderedVisibleFieldIds(viewId as string)
        ._unsafeUnwrap()
        .map((fieldId) => fieldId.toString());

      expect(orderedVisibleFieldIds).toEqual([
        primaryFieldId,
        statusFieldId as string,
        assigneeFieldId as string,
      ]);

      await db
        .updateTable('field')
        .set({ is_pending: true })
        .where('id', '=', assigneeFieldId as string)
        .execute();

      const loadedWithPendingField = await repo
        .findOne(context, table.specs().byId(table.id()).build()._unsafeUnwrap())
        .then((result) => result._unsafeUnwrap());
      expect(
        loadedWithPendingField.getFields().map((field) => field.id().toString())
      ).not.toContain(assigneeFieldId);
    } finally {
      await db.destroy();
      c.dispose();
    }
  });

  it('preserves explicit db table and field names on insert', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('Projects')._unsafeUnwrap();
      const customDbTableName = DbTableName.rehydrate(
        `${baseId.toString()}.custom_projects`
      )._unsafeUnwrap();
      const customDbFieldName = DbFieldName.rehydrate('project_label')._unsafeUnwrap();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(tableName)
        .withDbTableName(customDbTableName);
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      table.getFields()[0]?.setDbFieldName(customDbFieldName)._unsafeUnwrap();

      const persistedTable = (await repo.insert(context, table))._unsafeUnwrap();
      expect(
        persistedTable
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap()
      ).toBe(`${baseId.toString()}.custom_projects`);
      expect(
        persistedTable
          .getFields()[0]
          ?.dbFieldName()
          .andThen((name) => name.value())
          ._unsafeUnwrap()
      ).toBe('project_label');

      const tableMetaRow = await db
        .selectFrom('table_meta')
        .select(['db_table_name'])
        .where('id', '=', table.id().toString())
        .executeTakeFirst();
      expect(tableMetaRow?.db_table_name).toBe(`${baseId.toString()}.custom_projects`);

      const fieldRows = await db
        .selectFrom('field')
        .select(['db_field_name'])
        .where('table_id', '=', table.id().toString())
        .where('deleted_time', 'is', null)
        .execute();
      expect(fieldRows.map((row) => row.db_field_name)).toEqual(['project_label']);
    } finally {
      await db.destroy();
    }
  });

  it('normalizes v1 view filter list operators with null value', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('View Filter Table')._unsafeUnwrap();
      const nameField = FieldName.create('Name')._unsafeUnwrap();
      const categoryField = FieldName.create('Category')._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(nameField).primary().done();
      builder.field().singleLineText().withName(categoryField).done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      (await repo.insert(context, table))._unsafeUnwrap();

      const viewId = table.views()[0]?.id().toString();
      const categoryId = table
        .getFields()
        .find((field) => field.name().equals(categoryField))
        ?.id()
        .toString();
      expect(viewId).toBeDefined();
      expect(categoryId).toBeDefined();
      if (!viewId || !categoryId) return;

      await db
        .updateTable('view')
        .set({
          filter: JSON.stringify({
            conjunction: 'and',
            filterSet: [{ fieldId: categoryId, operator: 'isNoneOf', value: null }],
          }),
        })
        .where('id', '=', viewId)
        .execute();

      const specResult = Table.specs(baseId).byId(table.id()).build();
      specResult._unsafeUnwrap();
      const fetched = (await repo.findOne(context, specResult._unsafeUnwrap()))._unsafeUnwrap();

      const viewDefaults = fetched.views()[0]?.queryDefaults()._unsafeUnwrap();
      expect(viewDefaults?.filter()).toBeNull();
      expect(viewDefaults?.sourceFilter()).toEqual({
        conjunction: 'and',
        filterSet: [{ fieldId: categoryId, operator: 'isNoneOf', value: null }],
      });
    } finally {
      await db.destroy();
    }
  });

  it('finds host tables by incoming references across bases', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const foreignBaseId = BaseId.generate()._unsafeUnwrap();
      const hostBaseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Reference Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values([
          {
            id: foreignBaseId.toString(),
            space_id: spaceId,
            name: 'Foreign Base',
            order: 1,
            created_by: actorId.toString(),
          },
          {
            id: hostBaseId.toString(),
            space_id: spaceId,
            name: 'Host Base',
            order: 2,
            created_by: actorId.toString(),
          },
        ])
        .execute();

      const foreignBuilder = Table.builder()
        .withBaseId(foreignBaseId)
        .withName(TableName.create('Foreign')._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      (await repo.insert(context, foreignTable))._unsafeUnwrap();

      const linkFieldId = FieldId.generate()._unsafeUnwrap();
      const hostBuilder = Table.builder()
        .withBaseId(hostBaseId)
        .withName(TableName.create('Host')._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Name')._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(FieldName.create('Foreign Link')._unsafeUnwrap())
        .withConfig(
          LinkFieldConfig.create({
            baseId: foreignBaseId.toString(),
            relationship: 'manyMany',
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: foreignTable.primaryFieldId().toString(),
            isOneWay: true,
          })._unsafeUnwrap()
        )
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();
      (await repo.insert(context, hostTable))._unsafeUnwrap();

      const unrelatedBuilder = Table.builder()
        .withBaseId(hostBaseId)
        .withName(TableName.create('Unrelated')._unsafeUnwrap());
      unrelatedBuilder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title 2')._unsafeUnwrap())
        .primary()
        .done();
      unrelatedBuilder.view().defaultGrid().done();
      const unrelatedTable = unrelatedBuilder.build()._unsafeUnwrap();
      (await repo.insert(context, unrelatedTable))._unsafeUnwrap();

      await db
        .insertInto('reference')
        .values({
          id: `ref_${getRandomString(21)}`,
          from_field_id: foreignTable.primaryFieldId().toString(),
          to_field_id: linkFieldId.toString(),
        })
        .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing())
        .execute();

      const specResult = Table.specs().byIncomingReferenceToTable(foreignTable.id()).build();
      specResult._unsafeUnwrap();

      const tables = (await repo.find(context, specResult._unsafeUnwrap()))._unsafeUnwrap();

      expect(tables.map((table) => table.id().toString())).toEqual([hostTable.id().toString()]);
      expect(tables.some((table) => table.id().equals(unrelatedTable.id()))).toBe(false);
    } finally {
      await db.destroy();
    }
  });

  it('normalizes legacy dateRange filter values in view filters', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${'w'.repeat(16)}`)._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('Legacy Date Range Filter Table')._unsafeUnwrap();
      const nameField = FieldName.create('Name')._unsafeUnwrap();
      const dateField = FieldName.create('Sign Up Date')._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(nameField).primary().done();
      builder.field().date().withName(dateField).done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      (await repo.insert(context, table))._unsafeUnwrap();

      const viewId = table.views()[0]?.id().toString();
      const dateFieldId = table
        .getFields()
        .find((field) => field.name().equals(dateField))
        ?.id()
        .toString();
      expect(viewId).toBeDefined();
      expect(dateFieldId).toBeDefined();
      if (!viewId || !dateFieldId) return;

      await db
        .updateTable('view')
        .set({
          filter: JSON.stringify({
            conjunction: 'and',
            filterSet: [
              {
                fieldId: dateFieldId,
                operator: 'is',
                value: {
                  mode: 'dateRange',
                  exactDate: '2025-12-31T16:00:00.000Z',
                  exactDateEnd: '2026-01-31T15:59:59.999Z',
                  timeZone: 'Asia/Shanghai',
                },
              },
            ],
          }),
        })
        .where('id', '=', viewId)
        .execute();

      const specResult = Table.specs(baseId).byId(table.id()).build();
      specResult._unsafeUnwrap();
      const fetched = (await repo.findOne(context, specResult._unsafeUnwrap()))._unsafeUnwrap();

      const viewDefaults = fetched.views()[0]?.queryDefaults()._unsafeUnwrap();
      expect(viewDefaults?.filter()).toEqual({
        conjunction: 'and',
        items: [
          {
            conjunction: 'and',
            items: [
              {
                fieldId: dateFieldId,
                operator: 'isOnOrAfter',
                value: {
                  mode: 'exactDate',
                  exactDate: '2025-12-31T16:00:00.000Z',
                  timeZone: 'Asia/Shanghai',
                },
              },
              {
                fieldId: dateFieldId,
                operator: 'isOnOrBefore',
                value: {
                  mode: 'exactDate',
                  exactDate: '2026-01-31T15:59:59.999Z',
                  timeZone: 'Asia/Shanghai',
                },
              },
            ],
          },
        ],
      });
    } finally {
      await db.destroy();
    }
  });

  it('drops empty array values for v2 list operators in view filters', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${'x'.repeat(16)}`)._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('V2 Filter Table')._unsafeUnwrap();
      const nameField = FieldName.create('Name')._unsafeUnwrap();
      const categoryField = FieldName.create('Category')._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(nameField).primary().done();
      builder.field().singleLineText().withName(categoryField).done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      (await repo.insert(context, table))._unsafeUnwrap();

      const viewId = table.views()[0]?.id().toString();
      const categoryId = table
        .getFields()
        .find((field) => field.name().equals(categoryField))
        ?.id()
        .toString();
      expect(viewId).toBeDefined();
      expect(categoryId).toBeDefined();
      if (!viewId || !categoryId) return;

      await db
        .updateTable('view')
        .set({
          filter: JSON.stringify({
            conjunction: 'and',
            items: [
              {
                fieldId: categoryId,
                operator: 'isNoneOf',
                value: [],
              },
            ],
          }),
        })
        .where('id', '=', viewId)
        .execute();

      const specResult = Table.specs(baseId).byId(table.id()).build();
      specResult._unsafeUnwrap();
      const fetched = (await repo.findOne(context, specResult._unsafeUnwrap()))._unsafeUnwrap();

      const viewDefaults = fetched.views()[0]?.queryDefaults()._unsafeUnwrap();
      expect(viewDefaults?.filter()).toBeNull();
    } finally {
      await db.destroy();
    }
  });

  it('rehydrates generated column meta for system fields', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Meta Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Meta Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('Meta Table')._unsafeUnwrap();
      const primaryName = FieldName.create('Name')._unsafeUnwrap();
      const createdTimeName = FieldName.create('Created At')._unsafeUnwrap();
      const createdByName = FieldName.create('Created By')._unsafeUnwrap();
      const autoNumberName = FieldName.create('Auto Number')._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(primaryName).primary().done();
      builder.field().createdTime().withName(createdTimeName).done();
      builder.field().createdBy().withName(createdByName).done();
      builder.field().autoNumber().withName(autoNumberName).done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();

      (await repo.insert(context, table))._unsafeUnwrap();

      const specResult = Table.specs(baseId).byId(table.id()).build();
      specResult._unsafeUnwrap();
      const fetched = (await repo.findOne(context, specResult._unsafeUnwrap()))._unsafeUnwrap();

      const createdTimeField = fetched
        .getFields()
        .find((field) => field.type().toString() === 'createdTime') as CreatedTimeField | undefined;
      expect(createdTimeField).toBeDefined();
      if (!createdTimeField) return;
      expect(createdTimeField.isPersistedAsGeneratedColumn()._unsafeUnwrap()).toBe(true);

      const createdByField = fetched
        .getFields()
        .find((field) => field.type().toString() === 'createdBy') as CreatedByField | undefined;
      expect(createdByField).toBeDefined();
      if (!createdByField) return;
      // CreatedBy fields are NOT persisted as generated columns - they're populated via INSERT subquery
      expect(createdByField.isPersistedAsGeneratedColumn()._unsafeUnwrap()).toBe(false);

      const autoNumberField = fetched
        .getFields()
        .find((field) => field.type().toString() === 'autoNumber') as AutoNumberField | undefined;
      expect(autoNumberField).toBeDefined();
      if (!autoNumberField) return;
      expect(autoNumberField.isPersistedAsGeneratedColumn()._unsafeUnwrap()).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  it('persists and rehydrates aiConfig on create', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'AI Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'AI Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('AI Table')._unsafeUnwrap();
      const titleName = FieldName.create('Title')._unsafeUnwrap();
      const aiName = FieldName.create('AI Summary')._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(titleName).primary().done();
      builder.field().singleLineText().withName(aiName).done();
      builder.view().defaultGrid().done();

      const table = builder.build()._unsafeUnwrap();
      const aiField = table.getFields().find((field) => field.name().equals(aiName));
      expect(aiField).toBeDefined();
      if (!aiField) return;

      const aiConfig = {
        type: 'summary',
        modelKey: 'openai@gpt-4o@gpt',
        sourceFieldId: table.primaryFieldId().toString(),
      };
      aiField.setAiConfig(aiConfig)._unsafeUnwrap();

      (await repo.insert(context, table))._unsafeUnwrap();

      const row = await db
        .selectFrom('field')
        .select(['id', 'ai_config'])
        .where('id', '=', aiField.id().toString())
        .where('deleted_time', 'is', null)
        .executeTakeFirst();
      expect(row).toBeDefined();
      expect(JSON.parse(row?.ai_config ?? 'null')).toEqual(aiConfig);

      const spec = Table.specs(baseId).byId(table.id()).build()._unsafeUnwrap();
      const loaded = (await repo.findOne(context, spec))._unsafeUnwrap();
      const loadedAiField = loaded.getFields().find((field) => field.id().equals(aiField.id()));
      expect(loadedAiField?.aiConfig()).toEqual(aiConfig);
    } finally {
      await db.destroy();
    }
  });

  it('rejects duplicate db table names within a base', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Test Space', created_by: actorId.toString() })
        .execute();
      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Test Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const nameResult = TableName.create('Same Name');
      const fieldNameResult = FieldName.create('Title');

      const buildTable = () => {
        const builder = Table.builder().withBaseId(baseId).withName(nameResult._unsafeUnwrap());
        builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
        builder.view().defaultGrid().done();
        return builder.build();
      };

      const firstResult = buildTable();

      const firstInsert = await repo.insert(context, firstResult._unsafeUnwrap());
      firstInsert._unsafeUnwrap();

      const secondResult = buildTable();
      const secondInsert = await repo.insert(context, secondResult._unsafeUnwrap());
      secondInsert._unsafeUnwrap();

      const rows = await db
        .selectFrom('table_meta')
        .select(['id', 'db_table_name', 'base_id'])
        .where('base_id', '=', baseId.toString())
        .execute();
      expect(rows).toHaveLength(2);
      const dbNames = rows.map((row) => row.db_table_name).filter(Boolean);
      expect(new Set(dbNames).size).toBe(2);
      rows.forEach((row) => {
        expect(row.base_id).toBe(baseId.toString());
        expect(row.db_table_name).toBe(joinDbTableName(baseId.toString(), row.id));
      });
    } finally {
      await db.destroy();
    }
  });

  it('finds tables with sort and pagination', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const otherBaseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      [baseIdResult, otherBaseIdResult, actorIdResult].forEach((r) => r._unsafeUnwrap());
      baseIdResult._unsafeUnwrap();
      otherBaseIdResult._unsafeUnwrap();
      actorIdResult._unsafeUnwrap();

      const baseId = baseIdResult._unsafeUnwrap();
      const otherBaseId = otherBaseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };

      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Sort Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'List Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: otherBaseId.toString(),
          space_id: spaceId,
          name: 'Other Base',
          order: 2,
          created_by: actorId.toString(),
        })
        .execute();

      const buildAndInsert = async (targetBaseId: BaseId, name: string) => {
        const tableNameResult = TableName.create(name);
        const fieldNameResult = FieldName.create('Name');
        const tableName = tableNameResult._unsafeUnwrap();
        const fieldName = fieldNameResult._unsafeUnwrap();
        const builder = Table.builder().withBaseId(targetBaseId).withName(tableName);
        builder.field().singleLineText().withName(fieldName).done();
        builder.view().defaultGrid().done();
        const table = builder.build()._unsafeUnwrap();

        (await repo.insert(context, table))._unsafeUnwrap();
      };

      await buildAndInsert(baseId, 'Alpha');
      await buildAndInsert(baseId, 'Beta');
      await buildAndInsert(baseId, 'Gamma');
      await buildAndInsert(otherBaseId, 'Delta');

      const specResult = Table.specs(baseId).build();
      specResult._unsafeUnwrap();

      const sortResult = Sort.create([
        { key: TableSortKey.name(), direction: SortDirection.desc() },
      ]);
      sortResult._unsafeUnwrap();

      const limitResult = PageLimit.create(2);
      const offsetResult = PageOffset.create(1);
      [limitResult, offsetResult].forEach((r) => r._unsafeUnwrap());
      limitResult._unsafeUnwrap();
      offsetResult._unsafeUnwrap();

      const pagination = OffsetPagination.create(
        limitResult._unsafeUnwrap(),
        offsetResult._unsafeUnwrap()
      );
      const findResult = await repo.find(context, specResult._unsafeUnwrap(), {
        sort: sortResult._unsafeUnwrap(),
        pagination,
      });
      findResult._unsafeUnwrap();

      const names = findResult._unsafeUnwrap().map((table) => table.name().toString());
      expect(names).toEqual(['Beta', 'Alpha']);
      expect(findResult._unsafeUnwrap().every((table) => table.baseId().equals(baseId))).toBe(true);
    } finally {
      await db.destroy();
    }
  });

  it('initializes column meta for all view types', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      [baseIdResult, actorIdResult].forEach((r) => r._unsafeUnwrap());
      baseIdResult._unsafeUnwrap();
      actorIdResult._unsafeUnwrap();

      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Column Meta Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Column Meta Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableNameResult = TableName.create('Column Meta Table');
      const titleNameResult = FieldName.create('Title');
      const primaryNameResult = FieldName.create('Amount');
      const attachmentNameResult = FieldName.create('Files');
      const dateNameResult = FieldName.create('Due');
      const formulaNameResult = FieldName.create('Score');
      const buttonNameResult = FieldName.create('Action');
      [
        tableNameResult,
        titleNameResult,
        primaryNameResult,
        attachmentNameResult,
        dateNameResult,
        formulaNameResult,
        buttonNameResult,
      ].forEach((r) => r._unsafeUnwrap());
      tableNameResult._unsafeUnwrap();
      titleNameResult._unsafeUnwrap();
      primaryNameResult._unsafeUnwrap();
      formulaNameResult._unsafeUnwrap();
      buttonNameResult._unsafeUnwrap();

      const primaryIdResult = FieldId.generate();
      primaryIdResult._unsafeUnwrap();

      const primaryId = primaryIdResult._unsafeUnwrap();

      const formulaExpressionResult = FormulaExpression.create(`{${primaryId.toString()}} + 1`);
      formulaExpressionResult._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableNameResult._unsafeUnwrap());
      builder.field().singleLineText().withName(titleNameResult._unsafeUnwrap()).done();
      builder
        .field()
        .number()
        .withId(primaryId)
        .withName(primaryNameResult._unsafeUnwrap())
        .primary()
        .done();
      builder.field().attachment().withName(attachmentNameResult._unsafeUnwrap()).done();
      builder.field().date().withName(dateNameResult._unsafeUnwrap()).done();
      builder
        .field()
        .formula()
        .withName(formulaNameResult._unsafeUnwrap())
        .withExpression(formulaExpressionResult._unsafeUnwrap())
        .done();
      builder.field().button().withName(buttonNameResult._unsafeUnwrap()).done();

      builder.view().defaultGrid().done();
      builder.view().kanban().defaultName().done();
      builder.view().gallery().defaultName().done();
      builder.view().calendar().defaultName().done();
      builder.view().form().defaultName().done();
      builder.view().plugin().defaultName().done();

      const tableResult = builder.build();
      tableResult._unsafeUnwrap();

      const table = tableResult._unsafeUnwrap();
      const primaryFieldId = table.primaryFieldId().toString();
      const titleFieldId = table
        .getFields()
        .find((field) => field.name().toString() === 'Title')
        ?.id()
        .toString();
      const attachmentFieldId = table
        .getFields()
        .find((field) => field.name().toString() === 'Files')
        ?.id()
        .toString();
      const dateFieldId = table
        .getFields()
        .find((field) => field.name().toString() === 'Due')
        ?.id()
        .toString();

      table.views()[0]?.setOptions({ rowHeight: 'tall' })._unsafeUnwrap();
      if (titleFieldId) {
        table.views()[1]?.setOptions({ stackFieldId: titleFieldId })._unsafeUnwrap();
      }
      if (attachmentFieldId) {
        table.views()[2]?.setOptions({ coverFieldId: attachmentFieldId })._unsafeUnwrap();
      }
      if (dateFieldId) {
        table
          .views()[3]
          ?.setOptions({ startDateFieldId: dateFieldId, endDateFieldId: dateFieldId })
          ._unsafeUnwrap();
      }
      table.views()[4]?.setOptions({ submitText: 'Send' })._unsafeUnwrap();
      table
        .views()[5]
        ?.setOptions({
          pluginId: 'plg-sheet',
          pluginInstallId: 'pli-sheet',
          pluginLogo: 'logos/sheet.png',
        })
        ._unsafeUnwrap();

      const resolveResult = resolveFormulaFields(table);
      resolveResult._unsafeUnwrap();

      const insertResult = await repo.insert(context, table);
      insertResult._unsafeUnwrap();

      const viewRows = await db
        .selectFrom('view')
        .select(['type', 'column_meta', 'options'])
        .where('table_id', '=', table.id().toString())
        .where('deleted_time', 'is', null)
        .execute();

      expect(viewRows).toHaveLength(6);

      const fieldIds = table.getFields().map((field) => field.id().toString());
      const expectedOrder = [
        primaryFieldId,
        ...fieldIds.filter((fieldId) => fieldId !== primaryFieldId),
      ];

      const fieldIdsByName = new Map(
        table.getFields().map((field) => [field.name().toString(), field.id().toString()] as const)
      );

      const columnMetaByType = new Map(
        viewRows.map((row) => [row.type, JSON.parse(row.column_meta)] as const)
      );
      const optionsByType = new Map(
        viewRows.map(
          (row) => [row.type, row.options ? JSON.parse(row.options) : undefined] as const
        )
      );

      for (const [type, columnMeta] of columnMetaByType.entries()) {
        expect(columnMeta).toBeDefined();
        const metaFieldIds = Object.keys(columnMeta).sort();
        expect(metaFieldIds).toEqual([...fieldIds].sort());
        expectedOrder.forEach((fieldId, index) => {
          expect(columnMeta[fieldId]?.order).toBe(index);
        });
        if (type === 'grid' || type === 'plugin') {
          expect(columnMeta[primaryFieldId]?.visible).toBeUndefined();
        }
      }

      const formMeta = columnMetaByType.get('form');
      expect(formMeta?.[fieldIdsByName.get('Title')!]?.visible).toBe(true);
      expect(formMeta?.[fieldIdsByName.get('Amount')!]?.visible).toBe(true);
      expect(formMeta?.[fieldIdsByName.get('Score')!]?.visible).toBeUndefined();
      expect(formMeta?.[fieldIdsByName.get('Action')!]?.visible).toBeUndefined();

      ['kanban', 'gallery', 'calendar'].forEach((type) => {
        const columnMeta = columnMetaByType.get(type);
        expect(columnMeta?.[primaryFieldId]?.visible).toBe(true);
      });

      expect(optionsByType.get('grid')).toEqual({ rowHeight: 'tall' });
      expect(optionsByType.get('kanban')).toEqual({ stackFieldId: titleFieldId });
      expect(optionsByType.get('gallery')).toEqual({ coverFieldId: attachmentFieldId });
      expect(optionsByType.get('calendar')).toEqual({
        startDateFieldId: dateFieldId,
        endDateFieldId: dateFieldId,
      });
      expect(optionsByType.get('form')).toEqual({ submitText: 'Send' });
      expect(optionsByType.get('plugin')).toEqual({
        pluginId: 'plg-sheet',
        pluginInstallId: 'pli-sheet',
        pluginLogo: 'logos/sheet.png',
      });
    } finally {
      await db.destroy();
    }
  });

  it('filters tables by name like spec', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      [baseIdResult, actorIdResult].forEach((r) => r._unsafeUnwrap());
      baseIdResult._unsafeUnwrap();
      actorIdResult._unsafeUnwrap();

      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Search Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Search Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const buildAndInsert = async (name: string) => {
        const tableNameResult = TableName.create(name);
        const fieldNameResult = FieldName.create('Name');
        const tableName = tableNameResult._unsafeUnwrap();
        const fieldName = fieldNameResult._unsafeUnwrap();
        const builder = Table.builder().withBaseId(baseId).withName(tableName);
        builder.field().singleLineText().withName(fieldName).done();
        builder.view().defaultGrid().done();
        const table = builder.build()._unsafeUnwrap();

        (await repo.insert(context, table))._unsafeUnwrap();
      };

      await buildAndInsert('Alpha');
      await buildAndInsert('Beta');
      await buildAndInsert('Gamma');

      const queryNameResult = TableName.create('Al');
      queryNameResult._unsafeUnwrap();

      const specResult = Table.specs(baseId).byNameLike(queryNameResult._unsafeUnwrap()).build();
      specResult._unsafeUnwrap();

      const sortResult = Sort.create([
        { key: TableSortKey.name(), direction: SortDirection.asc() },
      ]);
      sortResult._unsafeUnwrap();

      const findResult = await repo.find(context, specResult._unsafeUnwrap(), {
        sort: sortResult._unsafeUnwrap(),
      });
      findResult._unsafeUnwrap();

      const names = findResult._unsafeUnwrap().map((table) => table.name().toString());
      expect(names).toEqual(['Alpha']);
    } finally {
      await db.destroy();
    }
  });

  it('persists rollup lookup options with link metadata', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      [baseIdResult, actorIdResult].forEach((r) => r._unsafeUnwrap());
      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Rollup Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Rollup Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const foreignTableNameResult = TableName.create('Foreign');
      const foreignPrimaryNameResult = FieldName.create('Title');
      const foreignValueNameResult = FieldName.create('Amount');
      [foreignTableNameResult, foreignPrimaryNameResult, foreignValueNameResult].forEach((r) =>
        r._unsafeUnwrap()
      );

      const foreignValueIdResult = FieldId.generate();
      foreignValueIdResult._unsafeUnwrap();
      const foreignValueId = foreignValueIdResult._unsafeUnwrap();

      const foreignBuilder = Table.builder()
        .withBaseId(baseId)
        .withName(foreignTableNameResult._unsafeUnwrap());
      foreignBuilder
        .field()
        .singleLineText()
        .withName(foreignPrimaryNameResult._unsafeUnwrap())
        .primary()
        .done();
      foreignBuilder
        .field()
        .number()
        .withId(foreignValueId)
        .withName(foreignValueNameResult._unsafeUnwrap())
        .done();
      foreignBuilder.view().defaultGrid().done();

      const foreignTableResult = foreignBuilder.build();
      foreignTableResult._unsafeUnwrap();
      const foreignTable = foreignTableResult._unsafeUnwrap();
      (await repo.insert(context, foreignTable))._unsafeUnwrap();

      const valuesField = foreignTable
        .getFields()
        .find((field) => field.id().equals(foreignValueId));
      expect(valuesField).toBeDefined();
      if (!valuesField) return;

      const hostTableNameResult = TableName.create('Host');
      const hostPrimaryNameResult = FieldName.create('Name');
      const linkFieldNameResult = FieldName.create('Link');
      const rollupFieldNameResult = FieldName.create('Total');
      [
        hostTableNameResult,
        hostPrimaryNameResult,
        linkFieldNameResult,
        rollupFieldNameResult,
      ].forEach((r) => r._unsafeUnwrap());

      const linkFieldIdResult = FieldId.generate();
      const rollupFieldIdResult = FieldId.generate();
      [linkFieldIdResult, rollupFieldIdResult].forEach((r) => r._unsafeUnwrap());
      const linkFieldId = linkFieldIdResult._unsafeUnwrap();
      const rollupFieldId = rollupFieldIdResult._unsafeUnwrap();

      const linkConfigResult = LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignValueId.toString(),
      });
      linkConfigResult._unsafeUnwrap();

      const rollupConfigResult = RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignValueId.toString(),
      });
      rollupConfigResult._unsafeUnwrap();

      const rollupExpressionResult = RollupExpression.create('sum({values})');
      rollupExpressionResult._unsafeUnwrap();

      const hostBuilder = Table.builder()
        .withBaseId(baseId)
        .withName(hostTableNameResult._unsafeUnwrap());
      hostBuilder
        .field()
        .singleLineText()
        .withName(hostPrimaryNameResult._unsafeUnwrap())
        .primary()
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(linkFieldNameResult._unsafeUnwrap())
        .withConfig(linkConfigResult._unsafeUnwrap())
        .done();
      hostBuilder
        .field()
        .rollup()
        .withId(rollupFieldId)
        .withName(rollupFieldNameResult._unsafeUnwrap())
        .withConfig(rollupConfigResult._unsafeUnwrap())
        .withExpression(rollupExpressionResult._unsafeUnwrap())
        .withValuesField(valuesField)
        .done();
      hostBuilder.view().defaultGrid().done();

      const hostTableResult = hostBuilder.build();
      hostTableResult._unsafeUnwrap();
      const hostTable = hostTableResult._unsafeUnwrap();
      (await repo.insert(context, hostTable))._unsafeUnwrap();

      const rollupRow = await db
        .selectFrom('field')
        .select(['lookup_options', 'lookup_linked_field_id'])
        .where('id', '=', rollupFieldId.toString())
        .where('deleted_time', 'is', null)
        .executeTakeFirst();

      expect(rollupRow?.lookup_linked_field_id).toBe(linkFieldId.toString());
      expect(rollupRow?.lookup_options).toBeDefined();

      const lookupOptions = rollupRow?.lookup_options
        ? (JSON.parse(rollupRow.lookup_options) as Record<string, unknown>)
        : {};

      expect(lookupOptions.linkFieldId).toBe(linkFieldId.toString());
      expect(lookupOptions.foreignTableId).toBe(foreignTable.id().toString());
      expect(lookupOptions.lookupFieldId).toBe(foreignValueId.toString());
      expect(lookupOptions.relationship).toBe('manyOne');
      expect(lookupOptions.fkHostTableName).toBe(
        `${baseId.toString()}.${hostTable.id().toString()}`
      );
      expect(lookupOptions.selfKeyName).toBe('__id');
      expect(lookupOptions.foreignKeyName).toBe(`__fk_${linkFieldId.toString()}`);
    } finally {
      await db.destroy();
    }
  });

  it('rehydrates lookup fields with db names and validation flags', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      [baseIdResult, actorIdResult].forEach((r) => r._unsafeUnwrap());
      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Lookup Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Lookup Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const foreignTableName = TableName.create('Foreign')._unsafeUnwrap();
      const foreignPrimaryName = FieldName.create('Title')._unsafeUnwrap();
      const foreignStatusName = FieldName.create('Status')._unsafeUnwrap();
      const foreignStatusId = FieldId.generate()._unsafeUnwrap();

      const optionResult = SelectOption.create({
        id: `cho${getRandomString(9)}`,
        name: 'Todo',
        color: 'orangeDark1',
      });
      optionResult._unsafeUnwrap();
      const foreignStatusOption = optionResult._unsafeUnwrap();

      const foreignBuilder = Table.builder().withBaseId(baseId).withName(foreignTableName);
      foreignBuilder.field().singleLineText().withName(foreignPrimaryName).primary().done();
      foreignBuilder
        .field()
        .singleSelect()
        .withId(foreignStatusId)
        .withName(foreignStatusName)
        .withOptions([foreignStatusOption])
        .done();
      foreignBuilder.view().defaultGrid().done();
      const foreignTable = foreignBuilder.build()._unsafeUnwrap();
      (await repo.insert(context, foreignTable))._unsafeUnwrap();

      const hostTableName = TableName.create('Host')._unsafeUnwrap();
      const hostPrimaryName = FieldName.create('Name')._unsafeUnwrap();
      const amountName = FieldName.create('Amount')._unsafeUnwrap();
      const linkFieldName = FieldName.create('Link')._unsafeUnwrap();
      const lookupFieldName = FieldName.create('Lookup')._unsafeUnwrap();
      const linkFieldId = FieldId.generate()._unsafeUnwrap();
      const lookupFieldId = FieldId.generate()._unsafeUnwrap();

      const linkConfig = LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignStatusId.toString(),
      })._unsafeUnwrap();

      const lookupOptions = LookupOptions.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignStatusId.toString(),
      })._unsafeUnwrap();

      const innerFieldId = FieldId.generate()._unsafeUnwrap();
      const innerFieldName = FieldName.create('Status Inner')._unsafeUnwrap();
      const innerField = createSingleSelectField({
        id: innerFieldId,
        name: innerFieldName,
        options: [foreignStatusOption],
      })._unsafeUnwrap();

      const notNullValue = FieldNotNull.create(true)._unsafeUnwrap();
      const uniqueValue = FieldUnique.create(true)._unsafeUnwrap();

      const hostBuilder = Table.builder().withBaseId(baseId).withName(hostTableName);
      hostBuilder.field().singleLineText().withName(hostPrimaryName).primary().done();
      hostBuilder
        .field()
        .number()
        .withName(amountName)
        .withNotNull(notNullValue)
        .withUnique(uniqueValue)
        .done();
      hostBuilder
        .field()
        .link()
        .withId(linkFieldId)
        .withName(linkFieldName)
        .withConfig(linkConfig)
        .done();
      hostBuilder
        .field()
        .lookup()
        .withId(lookupFieldId)
        .withName(lookupFieldName)
        .withLookupOptions(lookupOptions)
        .withInnerField(innerField)
        .done();
      hostBuilder.view().defaultGrid().done();
      const hostTable = hostBuilder.build()._unsafeUnwrap();
      (await repo.insert(context, hostTable))._unsafeUnwrap();

      const specResult = Table.specs(baseId).byId(hostTable.id()).build();
      specResult._unsafeUnwrap();
      const fetched = (await repo.findOne(context, specResult._unsafeUnwrap()))._unsafeUnwrap();

      const lookupField = fetched
        .getFields()
        .find((field) => field.type().toString() === 'lookup') as LookupField | undefined;
      expect(lookupField).toBeDefined();
      if (!lookupField) return;

      expect(lookupField.lookupOptions().linkFieldId().toString()).toBe(linkFieldId.toString());
      expect(lookupField.lookupOptions().foreignTableId().toString()).toBe(
        foreignTable.id().toString()
      );
      expect(lookupField.lookupOptions().lookupFieldId().toString()).toBe(
        foreignStatusId.toString()
      );

      const lookupDbFieldName = lookupField
        .dbFieldName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      expect(lookupDbFieldName.length).toBeGreaterThan(0);

      const amountField = fetched.getFields().find((field) => field.name().equals(amountName));
      expect(amountField?.notNull().toBoolean()).toBe(true);
      expect(amountField?.unique().toBoolean()).toBe(true);

      const amountDbFieldName = amountField
        ?.dbFieldName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      expect(amountDbFieldName?.length).toBeGreaterThan(0);
    } finally {
      await db.destroy();
    }
  });

  it('updates table name with mutate spec', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.generate();
      const actorIdResult = ActorId.create('system');
      [baseIdResult, actorIdResult].forEach((r) => r._unsafeUnwrap());
      baseIdResult._unsafeUnwrap();
      actorIdResult._unsafeUnwrap();

      const baseId = baseIdResult._unsafeUnwrap();
      const actorId = actorIdResult._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Rename Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Rename Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableNameResult = TableName.create('Before');
      const fieldNameResult = FieldName.create('Name');
      [tableNameResult, fieldNameResult].forEach((r) => r._unsafeUnwrap());
      tableNameResult._unsafeUnwrap();
      fieldNameResult._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableNameResult._unsafeUnwrap());
      builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
      builder.view().defaultGrid().done();
      const tableResult = builder.build();
      tableResult._unsafeUnwrap();

      const insertResult = await repo.insert(context, tableResult._unsafeUnwrap());
      insertResult._unsafeUnwrap();

      const inserted = insertResult._unsafeUnwrap();

      const whereSpecResult = inserted.specs().byId(inserted.id()).build();
      whereSpecResult._unsafeUnwrap();

      const nextNameResult = TableName.create('After');
      nextNameResult._unsafeUnwrap();

      const mutateSpec = TableByNameSpec.create(nextNameResult._unsafeUnwrap());
      const updateResult = await repo.updateOne(context, inserted, mutateSpec);
      updateResult._unsafeUnwrap();

      const findResult = await repo.findOne(context, whereSpecResult._unsafeUnwrap());
      findResult._unsafeUnwrap();

      expect(findResult._unsafeUnwrap().name().toString()).toBe('After');
    } finally {
      await db.destroy();
    }
  });

  it('increments field version on repeated field metadata updates', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Version Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Version Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const tableName = TableName.create('Version Table')._unsafeUnwrap();
      const fieldName = FieldName.create('Title')._unsafeUnwrap();

      const builder = Table.builder().withBaseId(baseId).withName(tableName);
      builder.field().singleLineText().withName(fieldName).primary().done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();

      const inserted = (await repo.insert(context, table))._unsafeUnwrap();
      const targetField = inserted.getFields()[0];
      expect(targetField).toBeDefined();
      if (!targetField) return;

      const firstRename = FieldName.create('Title v2')._unsafeUnwrap();
      const secondRename = FieldName.create('Title v3')._unsafeUnwrap();

      const firstUpdatePersist = (
        await repo.updateOne(
          context,
          inserted,
          TableUpdateFieldNameSpec.create(targetField.id(), targetField.name(), firstRename)
        )
      )._unsafeUnwrap();
      expect(firstUpdatePersist).toEqual({
        fieldVersionChanges: [
          {
            fieldId: targetField.id().toString(),
            oldVersion: 1,
            newVersion: 2,
          },
        ],
      });

      const secondUpdatePersist = (
        await repo.updateOne(
          context,
          inserted,
          TableUpdateFieldNameSpec.create(targetField.id(), firstRename, secondRename)
        )
      )._unsafeUnwrap();
      expect(secondUpdatePersist).toEqual({
        fieldVersionChanges: [
          {
            fieldId: targetField.id().toString(),
            oldVersion: 2,
            newVersion: 3,
          },
        ],
      });

      const row = await db
        .selectFrom('field')
        .select(['version', 'name'])
        .where('id', '=', targetField.id().toString())
        .executeTakeFirst();

      expect(row?.name).toBe('Title v3');
      expect(row?.version).toBe(3);
    } finally {
      await db.destroy();
    }
  });

  it('increments view version on view column meta updates', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'View Version Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'View Version Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('View Version Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();

      const inserted = (await repo.insert(context, table))._unsafeUnwrap();
      const view = inserted.views()[0];
      expect(view).toBeDefined();
      if (!view) return;

      const fieldId = inserted.primaryFieldId();
      const fieldKey = fieldId.toString();
      const currentMeta = view.columnMeta()._unsafeUnwrap().toDto();
      const nextMeta = ViewColumnMeta.create({
        ...currentMeta,
        [fieldKey]: {
          ...(currentMeta[fieldKey] ?? {}),
          width: 320,
        },
      })._unsafeUnwrap();

      const persistResult = (
        await repo.updateOne(
          context,
          inserted,
          TableUpdateViewColumnMetaSpec.create([
            {
              viewId: view.id(),
              fieldId,
              columnMeta: nextMeta,
            },
          ])
        )
      )._unsafeUnwrap();

      expect(persistResult).toEqual({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 1,
            newVersion: 2,
          },
        ],
      });

      const row = await db
        .selectFrom('view')
        .select(['version', 'column_meta'])
        .where('id', '=', view.id().toString())
        .executeTakeFirst();

      expect(row?.version).toBe(2);
      expect(row?.column_meta).toContain('"width":320');
    } finally {
      await db.destroy();
    }
  });

  it('rejects an update made from a stale Table aggregate View version', async () => {
    const c = container.createChildContainer();
    const db = await createPgDb(pgContainer.getConnectionUri());
    await registerV2PostgresStateAdapter(c, {
      db,
      ensureSchema: true,
    });
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseId = BaseId.generate()._unsafeUnwrap();
      const actorId = ActorId.create('system')._unsafeUnwrap();
      const context = { actorId };
      const spaceId = `spc${getRandomString(16)}`;

      await db
        .insertInto('space')
        .values({ id: spaceId, name: 'Stale View Space', created_by: actorId.toString() })
        .execute();

      await db
        .insertInto('base')
        .values({
          id: baseId.toString(),
          space_id: spaceId,
          name: 'Stale View Base',
          order: 1,
          created_by: actorId.toString(),
        })
        .execute();

      const builder = Table.builder()
        .withBaseId(baseId)
        .withName(TableName.create('Stale View Table')._unsafeUnwrap());
      builder
        .field()
        .singleLineText()
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const inserted = (
        await repo.insert(context, builder.build()._unsafeUnwrap())
      )._unsafeUnwrap();
      const querySpec = inserted.specs().byId(inserted.id()).build()._unsafeUnwrap();
      const firstAggregate = (await repo.findOne(context, querySpec))._unsafeUnwrap();
      const staleAggregate = (await repo.findOne(context, querySpec))._unsafeUnwrap();
      const viewId = firstAggregate.views()[0]!.id();

      const firstRename = firstAggregate
        .renameView(viewId, ViewName.create('First writer')._unsafeUnwrap())
        ._unsafeUnwrap();
      const firstPersist = (
        await repo.updateOne(
          context,
          firstRename.updateResult.table,
          firstRename.updateResult.mutateSpec
        )
      )._unsafeUnwrap();

      expect(firstPersist).toEqual({
        viewVersionChanges: [
          {
            viewId: viewId.toString(),
            oldVersion: 1,
            newVersion: 2,
          },
        ],
      });

      const staleRename = staleAggregate
        .renameView(viewId, ViewName.create('Stale writer')._unsafeUnwrap())
        ._unsafeUnwrap();
      const stalePersist = await repo.updateOne(
        context,
        staleRename.updateResult.table,
        staleRename.updateResult.mutateSpec
      );

      expect(stalePersist._unsafeUnwrapErr()).toMatchObject({
        code: 'view.version_conflict',
        tags: ['conflict'],
        details: {
          tableId: inserted.id().toString(),
          viewId: viewId.toString(),
          expectedVersion: 1,
          actualVersion: 2,
        },
      });

      const row = await db
        .selectFrom('view')
        .select(['name', 'version'])
        .where('id', '=', viewId.toString())
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ name: 'First writer', version: 2 });
    } finally {
      await db.destroy();
    }
  });
});
