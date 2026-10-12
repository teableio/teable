/**
 * Sanitized structure-equivalent of T7710.
 *
 * Retained facts:
 * - two-way manyOne link fields from Comments -> Requests. The link value is
 *   materialized in comments."<linkFieldDbName>" from comments."__fk_<linkFieldId>".
 * - one link field lost its physical `__fk_<linkFieldId>` column, and a second lost only
 *   its own value column (the UPDATE's SET target), while both fields are still visible
 *   to computed work. That is the state a concurrent field deletion or schema repair
 *   leaves behind: the physical change is committed outside the metadata transaction,
 *   so a queued backfill can still resolve the field.
 * - a queued field-backfill task (the payload shape the delete cascade enqueues) is
 *   drained by the real worker, together with a sibling link field whose stored value
 *   must still be backfilled.
 *
 * No customer identifiers or values.
 */
import {
  buildFieldBackfillTaskInput,
  v2RecordRepositoryPostgresTokens,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  BaseId,
  FieldId,
  TableId,
  getRandomString,
  v2CoreTokens,
  type IHasher,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

type FieldDto = {
  id: string;
  dbFieldName?: string;
  options?: { foreignKeyName?: string };
};

describe('computed field backfill skips missing link storage (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 60_000);

  it('completes a queued field-backfill when the target link storage is gone', async () => {
    const requests = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Requests ${getRandomString(6)}`,
      fields: [
        {
          type: 'singleLineText',
          id: createFieldId(),
          name: 'Name',
          isPrimary: true,
        },
      ],
      views: [{ type: 'grid' }],
    });

    const requestNameFieldId = (requests.fields[0] as { id: string }).id;
    const commentsBodyFieldId = createFieldId();
    const requestLinkFieldId = createFieldId();
    const archivedLinkFieldId = createFieldId();
    const legacyLinkFieldId = createFieldId();

    const comments = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Comments ${getRandomString(6)}`,
      fields: [
        { type: 'singleLineText', id: commentsBodyFieldId, name: 'Body', isPrimary: true },
        {
          type: 'link',
          id: requestLinkFieldId,
          name: 'Request',
          options: {
            relationship: 'manyOne',
            foreignTableId: requests.id,
            lookupFieldId: requestNameFieldId,
          },
        },
        {
          type: 'link',
          id: archivedLinkFieldId,
          name: 'Archived request',
          options: {
            relationship: 'manyOne',
            foreignTableId: requests.id,
            lookupFieldId: requestNameFieldId,
          },
        },
        {
          type: 'link',
          id: legacyLinkFieldId,
          name: 'Legacy request',
          options: {
            relationship: 'manyOne',
            foreignTableId: requests.id,
            lookupFieldId: requestNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const request = await ctx.createRecord(requests.id, { [requestNameFieldId]: 'Seed request' });
    await ctx.createRecord(comments.id, {
      [commentsBodyFieldId]: 'Seed comment',
      [requestLinkFieldId]: { id: request.id },
      [archivedLinkFieldId]: { id: request.id },
      [legacyLinkFieldId]: { id: request.id },
    });
    await ctx.drainOutbox();

    const commentsTable = await ctx.getTableById(comments.id);
    const requestLink = commentsTable.fields.find((field) => field.id === requestLinkFieldId) as
      | FieldDto
      | undefined;
    const archivedLink = commentsTable.fields.find((field) => field.id === archivedLinkFieldId) as
      | FieldDto
      | undefined;
    const legacyLink = commentsTable.fields.find((field) => field.id === legacyLinkFieldId) as
      | FieldDto
      | undefined;

    const foreignKeyName = archivedLink?.options?.foreignKeyName;
    const archivedDbFieldName = archivedLink?.dbFieldName;
    const legacyForeignKeyName = legacyLink?.options?.foreignKeyName;
    const legacyDbFieldName = legacyLink?.dbFieldName;
    const requestDbFieldName = requestLink?.dbFieldName;
    expect(foreignKeyName).toMatch(/^__fk_/);
    expect(legacyForeignKeyName).toMatch(/^__fk_/);
    expect(archivedDbFieldName).toBeTruthy();
    expect(legacyDbFieldName).toBeTruthy();
    expect(requestDbFieldName).toBeTruthy();

    const dbTableName = `${ctx.baseId}.${comments.id}`;

    // The concurrent field deletion already dropped the FK helper column of the
    // archived link field; the metadata still exposes the field to computed work.
    await sql`
      ALTER TABLE ${sql.table(dbTableName)}
      DROP COLUMN IF EXISTS ${sql.ref(foreignKeyName!)} CASCADE
    `.execute(ctx.testContainer.db);

    const dropped = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ${ctx.baseId}
          AND table_name = ${comments.id}
          AND column_name = ${foreignKeyName!}
      ) as "exists"
    `.execute(ctx.testContainer.db);
    expect(dropped.rows[0]?.exists).toBe(false);

    // A second vanished-storage shape: only the field's own value column is gone while
    // its FK helper column survives, so the join-column probe alone cannot skip it.
    await sql`
      ALTER TABLE ${sql.table(dbTableName)}
      DROP COLUMN IF EXISTS ${sql.ref(legacyDbFieldName!)} CASCADE
    `.execute(ctx.testContainer.db);
    const legacyColumns = await sql<{ value_exists: boolean; fk_exists: boolean }>`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ${ctx.baseId}
            AND table_name = ${comments.id}
            AND column_name = ${legacyDbFieldName!}
        ) as "value_exists",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = ${ctx.baseId}
            AND table_name = ${comments.id}
            AND column_name = ${legacyForeignKeyName!}
        ) as "fk_exists"
    `.execute(ctx.testContainer.db);
    expect(legacyColumns.rows[0]?.value_exists).toBe(false);
    expect(legacyColumns.rows[0]?.fk_exists).toBe(true);

    // Stale stored value for the sibling link field: the backfill must restore it.
    await sql`
      UPDATE ${sql.table(dbTableName)}
      SET ${sql.ref(requestDbFieldName!)} = NULL
    `.execute(ctx.testContainer.db);
    const stale = await sql<{ value: unknown }>`
      SELECT ${sql.ref(requestDbFieldName!)} as "value" FROM ${sql.table(dbTableName)}
    `.execute(ctx.testContainer.db);
    expect(stale.rows[0]?.value).toBeNull();

    const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const hasher = ctx.testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);

    const enqueued = await outbox.enqueueFieldBackfill(
      buildFieldBackfillTaskInput({
        baseId: BaseId.create(ctx.baseId)._unsafeUnwrap(),
        tableId: TableId.create(comments.id)._unsafeUnwrap(),
        fieldIds: [
          FieldId.create(archivedLinkFieldId)._unsafeUnwrap(),
          FieldId.create(legacyLinkFieldId)._unsafeUnwrap(),
          FieldId.create(requestLinkFieldId)._unsafeUnwrap(),
        ],
        hasher,
        runId: `bfr${getRandomString(16)}`,
        estimatedRowCount: 1,
      })
    );
    expect(enqueued.isOk()).toBe(true);

    await ctx.drainOutbox();

    const deadLetters = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error'])
      .execute();
    expect(deadLetters).toEqual([]);

    const backfilled = await sql<{ value: unknown }>`
      SELECT ${sql.ref(requestDbFieldName!)} as "value" FROM ${sql.table(dbTableName)}
    `.execute(ctx.testContainer.db);
    expect(backfilled.rows[0]?.value).not.toBeNull();
  }, 120_000);
});
