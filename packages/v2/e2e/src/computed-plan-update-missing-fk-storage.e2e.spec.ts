/**
 * Sanitized structure-equivalent of T7711.
 *
 * Retained facts:
 * - a manyOne link on Comments -> Requests whose value is materialized in
 *   comments."<linkFieldDbName>" and derived by the plan's update step through the join
 *   column comments."__fk_<linkFieldId>".
 * - the reported metadata drift: the link's `symmetricFieldId` points at an existing
 *   plain text field, so the link advertises a `__fk_` column that the physical table
 *   never got, exactly like the structure copy in production.
 * - the trigger is the seed payload a record delete on the foreign table records
 *   (changeType=delete with seed groups for the deleted record and the host row that
 *   referenced it), planned and executed by the real worker.
 *
 * The delete clears the foreign key of an incoming link it can reach; the reported
 * failure is the planned update step that still has to write the link value of the
 * drifted field, which the worker must skip instead of dead-lettering.
 *
 * No customer identifiers or values.
 */
import { getRandomString } from '@teable/v2-core';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateSeedTaskInput,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

type FieldDto = {
  id: string;
  dbFieldName?: string;
  options?: { foreignKeyName?: string };
};

describe('computed plan update skips vanished link storage (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 60_000);

  it('completes a planned update when the link join column is gone', async () => {
    const requests = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Requests ${getRandomString(6)}`,
      fields: [{ type: 'singleLineText', id: createFieldId(), name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const requestNameFieldId = (requests.fields[0] as { id: string }).id;

    // The field the drifted link points at as its "symmetric" side, mirroring the
    // structure copy: an existing plain text field, not a link.
    const driftedSymmetricFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: requests.id,
      field: { type: 'singleLineText', id: driftedSymmetricFieldId, name: 'Note' },
    });

    const commentsBodyFieldId = createFieldId();
    const requestLinkFieldId = createFieldId();
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
            symmetricFieldId: driftedSymmetricFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const request = await ctx.createRecord(requests.id, { [requestNameFieldId]: 'Seed request' });
    const comment = await ctx.createRecord(comments.id, {
      [commentsBodyFieldId]: 'Seed comment',
      [requestLinkFieldId]: { id: request.id },
    });
    await ctx.drainOutbox();

    const commentsTable = await ctx.getTableById(comments.id);
    const link = commentsTable.fields.find((field) => field.id === requestLinkFieldId) as
      | FieldDto
      | undefined;
    const foreignKeyName = link?.options?.foreignKeyName;
    const linkDbFieldName = link?.dbFieldName;
    expect(foreignKeyName).toMatch(/^__fk_/);
    expect(linkDbFieldName).toBeTruthy();

    // The drift: the FK helper column is not on the physical table while the field
    // metadata still advertises it (also true for a repair that dropped and never
    // re-added it).
    await sql`
      ALTER TABLE ${sql.table(`${ctx.baseId}.${comments.id}`)}
      DROP COLUMN IF EXISTS ${sql.ref(foreignKeyName!)} CASCADE
    `.execute(ctx.testContainer.db);
    const dropped = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${ctx.baseId}
          AND table_name = ${comments.id}
          AND column_name = ${foreignKeyName!}
      ) as "exists"
    `.execute(ctx.testContainer.db);
    expect(dropped.rows[0]?.exists).toBe(false);

    // The report's trigger: the foreign record is deleted, then the seed payload that
    // delete records is planned and executed by the worker.
    await ctx.deleteRecord(requests.id, request.id);

    const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const seedInput: ComputedUpdateSeedTaskInput = {
      taskType: 'seed',
      baseId: ctx.baseId,
      seedTableId: requests.id,
      seedRecordIds: [request.id],
      extraSeedRecords: [{ tableId: comments.id, recordIds: [comment.id] }],
      beforeImageRecords: [],
      changedFieldIds: [requestNameFieldId],
      changeType: 'delete',
      runId: `bfr${getRandomString(16)}`,
      planHash: `bfp${getRandomString(16)}`,
    };
    const enqueued = await outbox.enqueueSeedTask(seedInput);
    expect(enqueued.isOk()).toBe(true);

    await ctx.drainOutbox();

    const deadLetters = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error'])
      .execute();
    expect(deadLetters).toEqual([]);

    const pending = await ctx.testContainer.db
      .selectFrom('computed_update_outbox')
      .select(['id', 'status'])
      .execute();
    expect(pending).toEqual([]);

    // The run converged with the drifted field skipped: its stored value is untouched
    // (the delete cleanup cannot reach it because the join column is gone), which is the
    // state the drift leaves until the integrity repair rebuilds the column.
    const values = await sql<{ value: unknown }>`
      SELECT ${sql.ref(linkDbFieldName!)} as "value"
      FROM ${sql.table(`${ctx.baseId}.${comments.id}`)}
    `.execute(ctx.testContainer.db);
    expect(values.rows[0]?.value).not.toBeNull();
  }, 120_000);
});
