/* eslint-disable @typescript-eslint/naming-convention */
import type {
  AttachmentField,
  ButtonField,
  CheckboxField,
  DateField,
  IFieldVisitor,
  ITableRepository,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  SingleSelectField,
  SingleLineTextField,
  UserField,
} from '@teable/v2-core';
import {
  ActorId,
  BaseId,
  FieldName,
  RatingColor,
  RatingIcon,
  RatingMax,
  SelectOption,
  Table,
  TableName,
  v2CoreTokens,
} from '@teable/v2-core';
import { v2PostgresDbTokens } from '@teable/v2-db-postgres';
import { container } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type StartedPostgreSqlContainer = Awaited<ReturnType<PostgreSqlContainer['start']>>;

import { registerV2PostgresStateAdapter } from '../di/register';
import { convertNameToValidCharacter } from '../naming';

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
  | { type: 'user'; name: string }
  | { type: 'button'; name: string };

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

  visitUserField(field: UserField) {
    const snapshot: IFieldSnapshot = { type: 'user', name: field.name().toString() };
    return ok(snapshot);
  }

  visitButtonField(field: ButtonField) {
    const snapshot: IFieldSnapshot = { type: 'button', name: field.name().toString() };
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
    await registerV2PostgresStateAdapter(c, {
      pg: { connectionString: pgContainer.getConnectionUri() },
      ensureSchema: true,
    });

    const db = c.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const repo = c.resolve<ITableRepository>(v2CoreTokens.tableRepository);

    try {
      const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
      expect(baseIdResult.isOk()).toBe(true);
      if (baseIdResult.isErr()) return;
      const baseId = baseIdResult.value;
      const spaceId = `spc${'a'.repeat(16)}`;
      const actorIdResult = ActorId.create('system');
      expect(actorIdResult.isOk()).toBe(true);
      if (actorIdResult.isErr()) return;
      const actorId = actorIdResult.value;
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
      const statusNameResult = FieldName.create('Status');
      expect(
        [tableNameResult, titleNameResult, priorityNameResult, statusNameResult].every((r) =>
          r.isOk()
        )
      ).toBe(true);
      if (
        tableNameResult.isErr() ||
        titleNameResult.isErr() ||
        priorityNameResult.isErr() ||
        statusNameResult.isErr()
      )
        return;

      const todoOptionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
      const doneOptionResult = SelectOption.create({ name: 'Done', color: 'red' });
      const iconResult = RatingIcon.create('moon');
      const colorResult = RatingColor.create('redBright');
      expect(
        [todoOptionResult, doneOptionResult, iconResult, colorResult].every((r) => r.isOk())
      ).toBe(true);
      if (
        todoOptionResult.isErr() ||
        doneOptionResult.isErr() ||
        iconResult.isErr() ||
        colorResult.isErr()
      )
        return;

      const builder = Table.builder().withBaseId(baseId).withName(tableNameResult.value);
      builder.field().singleLineText().withName(titleNameResult.value).done();
      builder
        .field()
        .rating()
        .withName(priorityNameResult.value)
        .withMax(RatingMax.five())
        .withIcon(iconResult.value)
        .withColor(colorResult.value)
        .primary()
        .done();
      builder
        .field()
        .singleSelect()
        .withName(statusNameResult.value)
        .withOptions([todoOptionResult.value, doneOptionResult.value])
        .done();
      builder.view().defaultGrid().done();
      builder.view().kanban().defaultName().done();

      const tableResult = builder.build();
      expect(tableResult.isOk()).toBe(true);
      if (tableResult.isErr()) return;
      const table = tableResult.value;
      expect(table.primaryFieldId().equals(table.fields()[1].id())).toBe(true);

      const insertResult = await repo.insert(context, table);
      expect(insertResult.isOk()).toBe(true);
      if (insertResult.isErr()) return;
      const persistedTable = insertResult.value;

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

      const expectedDbTableName = `${baseId.toString()}.${convertNameToValidCharacter(
        table.name().toString(),
        40
      )}`;
      const dbTableNameResult = persistedTable.dbTableName().andThen((name) => name.value());
      expect(dbTableNameResult.isOk()).toBe(true);
      if (dbTableNameResult.isErr()) return;
      expect(dbTableNameResult.value).toBe(expectedDbTableName);

      const tableMetaRow = await db
        .selectFrom('table_meta')
        .select(['db_table_name', 'base_id'])
        .where('id', '=', table.id().toString())
        .executeTakeFirst();
      expect(tableMetaRow?.db_table_name).toBe(expectedDbTableName);
      expect(tableMetaRow?.base_id).toBe(baseId.toString());

      const expectedDbFieldNames = table
        .fields()
        .map((field) => convertNameToValidCharacter(field.name().toString(), 40));
      const dbFieldNameResults = persistedTable
        .fields()
        .map((field) => field.dbFieldName().andThen((name) => name.value()));
      expect(dbFieldNameResults.every((result) => result.isOk())).toBe(true);
      if (dbFieldNameResults.some((result) => result.isErr())) return;
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

      const byIdSpecResult = Table.specs(baseId).byId(table.id()).build();
      expect(byIdSpecResult.isOk()).toBe(true);
      if (byIdSpecResult.isErr()) return;
      const byIdResult = await repo.findOne(context, byIdSpecResult.value);
      expect(byIdResult.isOk()).toBe(true);
      if (byIdResult.isErr()) return;

      const loaded = byIdResult.value;
      expect(loaded.id().toString()).toBe(table.id().toString());
      expect(loaded.name().toString()).toBe(table.name().toString());
      expect(loaded.primaryFieldId().equals(table.primaryFieldId())).toBe(true);
      const loadedDbTableNameResult = loaded.dbTableName().andThen((name) => name.value());
      expect(loadedDbTableNameResult.isOk()).toBe(true);
      if (loadedDbTableNameResult.isErr()) return;
      expect(loadedDbTableNameResult.value).toBe(expectedDbTableName);
      expect(
        loaded.views().map((v) => ({ name: v.name().toString(), type: v.type().toString() }))
      ).toEqual([
        { name: 'Grid', type: 'grid' },
        { name: 'Kanban', type: 'kanban' },
      ]);

      const snapshotVisitor: IFieldVisitor<IFieldSnapshot> = new FieldToSnapshotVisitor();
      const fieldSnapshots = loaded.fields().map((f) => f.accept(snapshotVisitor));
      expect(fieldSnapshots.every((r) => r.isOk())).toBe(true);
      if (fieldSnapshots.some((r) => r.isErr())) return;

      expect(fieldSnapshots.map((r) => r._unsafeUnwrap())).toEqual<IFieldSnapshot[]>([
        { type: 'singleLineText', name: 'Name' },
        { type: 'rating', name: 'Priority', max: 5, icon: 'moon', color: 'redBright' },
        {
          type: 'singleSelect',
          name: 'Status',
          options: [
            { name: 'Todo', color: 'blue' },
            { name: 'Done', color: 'red' },
          ],
        },
      ]);

      const byNameSpecResult = Table.specs(baseId).byName(table.name()).build();
      expect(byNameSpecResult.isOk()).toBe(true);
      if (byNameSpecResult.isErr()) return;
      const byNameResult = await repo.findOne(context, byNameSpecResult.value);
      expect(byNameResult.isOk()).toBe(true);
    } finally {
      await db.destroy();
    }
  });
});
