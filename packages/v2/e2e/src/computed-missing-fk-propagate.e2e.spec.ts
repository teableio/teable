/**
 * Sanitized structure-equivalent of T7070.
 *
 * Retained facts:
 * - two-way manyOne from Comments → Requests
 * - physical `__fk_<linkFieldId>` column is missing while field.options still
 *   advertises foreignKeyName
 * - createRecord on Requests must not fail the whole computed UNION ALL
 *
 * No customer identifiers or values.
 */
import { sql } from 'kysely';
import { getRandomString } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

describe('computed propagate skips missing manyOne FK column (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 60_000);

  it('createRecord on the one side succeeds when the manyOne FK column is missing', async () => {
    const requestNameFieldId = createFieldId();
    const requests = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Requests ${getRandomString(6)}`,
      fields: [{ type: 'singleLineText', id: requestNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const commentNameFieldId = createFieldId();
    const requestLinkFieldId = createFieldId();
    const requestLookupFieldId = createFieldId();
    const comments = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Comments ${getRandomString(6)}`,
      fields: [
        { type: 'singleLineText', id: commentNameFieldId, name: 'Body', isPrimary: true },
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
          type: 'lookup',
          id: requestLookupFieldId,
          name: 'Request name',
          options: {
            linkFieldId: requestLinkFieldId,
            foreignTableId: requests.id,
            lookupFieldId: requestNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const seedRequest = await ctx.createRecord(requests.id, {
      [requestNameFieldId]: 'Seed request',
    });
    await ctx.createRecord(comments.id, {
      [commentNameFieldId]: 'Seed comment',
      [requestLinkFieldId]: { id: seedRequest.id },
    });
    await ctx.drainOutbox();

    const commentsTable = await ctx.getTableById(comments.id);
    const requestLink = commentsTable.fields.find(
      (field: { id: string; options?: unknown }) => field.id === requestLinkFieldId
    );
    const foreignKeyName = (requestLink?.options as { foreignKeyName?: string } | undefined)
      ?.foreignKeyName;
    expect(foreignKeyName).toMatch(/^__fk_/);

    await sql`
      ALTER TABLE ${sql.table(`${ctx.baseId}.${comments.id}`)}
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

    const created = await ctx.createRecord(requests.id, {
      [requestNameFieldId]: 'Second request',
    });
    expect(created.id).toEqual(expect.any(String));
    await ctx.drainOutbox();
  }, 120_000);
});
