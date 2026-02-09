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
  TableSortKey,
  createSingleSelectField,
  v2CoreTokens,
  domainError,
} from '@teable/v2-core';
import { container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
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

      const snapshotVisitor: IFieldVisitor<IFieldSnapshot> = new FieldToSnapshotVisitor();
      const fieldSnapshots = loaded.getFields().map((f) => f.accept(snapshotVisitor));
      fieldSnapshots.forEach((r) => r._unsafeUnwrap());
      fieldSnapshots.forEach((r) => r._unsafeUnwrap());

      expect(fieldSnapshots.map((r) => r._unsafeUnwrap())).toEqual<IFieldSnapshot[]>([
        { type: 'singleLineText', name: 'Name' },
        { type: 'rating', name: 'Priority', max: 5, icon: 'moon', color: 'redBright' },
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
      const formulaNameResult = FieldName.create('Score');
      const buttonNameResult = FieldName.create('Action');
      [
        tableNameResult,
        titleNameResult,
        primaryNameResult,
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

      const resolveResult = resolveFormulaFields(table);
      resolveResult._unsafeUnwrap();

      const insertResult = await repo.insert(context, table);
      insertResult._unsafeUnwrap();

      const viewRows = await db
        .selectFrom('view')
        .select(['type', 'column_meta'])
        .where('table_id', '=', table.id().toString())
        .where('deleted_time', 'is', null)
        .execute();

      expect(viewRows).toHaveLength(6);

      const fieldIds = table.getFields().map((field) => field.id().toString());
      const primaryFieldId = table.primaryFieldId().toString();
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
});
