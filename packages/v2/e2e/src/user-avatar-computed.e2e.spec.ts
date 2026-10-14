/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const alice = {
  id: 'usrAvatarComputedAlice',
  title: 'Snapshot Alice',
  email: 'alice@example.com',
};
const bob = {
  id: 'usrAvatarComputedBob',
  title: 'Snapshot Bob',
  email: 'bob@example.com',
};
const legacyAlice = { ...alice, avatarUrl: 'https://old.example.com/avatar/alice' };
const legacyBob = { ...bob, avatarUrl: 'https://old.example.com/avatar/bob' };
const displayedAlice = { ...alice, avatarUrl: `https://current.example.com/avatar/${alice.id}` };
const displayedBob = { ...bob, avatarUrl: `https://current.example.com/avatar/${bob.id}` };

/** Historical source snapshots must not spread deployment-specific URLs into derived storage. */
describe('computed user avatar persistence (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const fieldColumn = async (fieldId: string) => {
    const field = await ctx.testContainer.db
      .selectFrom('field')
      .select('db_field_name')
      .where('id', '=', fieldId)
      .executeTakeFirstOrThrow();
    if (!field.db_field_name) throw new Error(`Missing physical column for ${fieldId}`);
    return field.db_field_name;
  };

  it.each([
    { type: 'user', isMultiple: false },
    { type: 'user', isMultiple: true },
    { type: 'createdBy', isMultiple: false },
    { type: 'lastModifiedBy', isMultiple: false },
  ] as const)(
    'strips legacy URLs from $type (multiple=$isMultiple) lookup backfill and recomputation',
    async ({ type, isMultiple }) => {
      let sourceTableId: string | undefined;
      let hostTableId: string | undefined;
      vi.stubEnv('BACKEND_STORAGE_PUBLIC_URL', 'https://current.example.com');

      try {
        const sourceTitleId = `fld${getRandomString(16)}`;
        const sourceUserId = `fld${getRandomString(16)}`;
        const hostKeyId = `fld${getRandomString(16)}`;
        const linkId = `fld${getRandomString(16)}`;
        const lookupId = `fld${getRandomString(16)}`;
        const conditionalId = `fld${getRandomString(16)}`;
        const source = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Avatar sources ${getRandomString(6)}`,
          fields: [
            { type: 'singleLineText', id: sourceTitleId, name: 'Key', isPrimary: true },
            type === 'user'
              ? {
                  type,
                  id: sourceUserId,
                  name: 'Member',
                  options: { isMultiple, shouldNotify: false },
                }
              : { type, id: sourceUserId, name: 'Member' },
          ],
        });
        sourceTableId = source.id;
        const first = await ctx.createRecord(source.id, { [sourceTitleId]: 'first' });
        const second = await ctx.createRecord(source.id, { [sourceTitleId]: 'second' });
        await ctx.drainOutbox();

        const sourceColumn = await fieldColumn(sourceUserId);
        const firstLegacy = isMultiple ? [legacyBob, legacyAlice] : legacyAlice;
        const secondLegacy = isMultiple ? [legacyAlice, legacyBob] : legacyBob;
        for (const [recordId, value] of [
          [first.id, firstLegacy],
          [second.id, secondLegacy],
        ] as const) {
          await sql`
            UPDATE ${sql.table(`${ctx.baseId}.${source.id}`)}
            SET ${sql.ref(sourceColumn)} = ${JSON.stringify(value)}::jsonb
            WHERE "__id" = ${recordId}
          `.execute(ctx.testContainer.db);
        }

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Avatar lookups ${getRandomString(6)}`,
          fields: [
            { type: 'singleLineText', id: hostKeyId, name: 'Key', isPrimary: true },
            {
              type: 'link',
              id: linkId,
              name: 'Source',
              options: {
                relationship: 'manyOne',
                foreignTableId: source.id,
                lookupFieldId: sourceTitleId,
                isOneWay: true,
              },
            },
          ],
        });
        hostTableId = host.id;
        const linked = await ctx.createRecord(host.id, {
          [hostKeyId]: 'first',
          [linkId]: { id: first.id },
        });
        const empty = await ctx.createRecord(host.id, { [hostKeyId]: 'unmatched' });

        // Adding fields after records exist exercises the ordinary backfill UPDATE path.
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupId,
            name: 'Linked member',
            options: {
              linkFieldId: linkId,
              foreignTableId: source.id,
              lookupFieldId: sourceUserId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalLookup',
            id: conditionalId,
            name: 'Matching members',
            options: {
              foreignTableId: source.id,
              lookupFieldId: sourceUserId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    { fieldId: sourceTitleId, operator: 'is', value: hostKeyId, isSymbol: true },
                  ],
                },
              },
            },
          },
        });
        const lookupColumn = await fieldColumn(lookupId);
        const conditionalColumn = await fieldColumn(conditionalId);

        const assertValues = async (
          recordId: string,
          stored: unknown,
          storedConditional: unknown,
          displayed: unknown,
          displayedConditional: unknown
        ) => {
          await ctx.drainOutbox();
          const physical = await sql<{ linked: unknown; conditional: unknown }>`
            SELECT ${sql.ref(lookupColumn)} AS linked,
                   ${sql.ref(conditionalColumn)} AS conditional
            FROM ${sql.table(`${ctx.baseId}.${host.id}`)} WHERE "__id" = ${recordId}
          `.execute(ctx.testContainer.db);
          expect(physical.rows).toEqual([{ linked: stored, conditional: storedConditional }]);
          const records = await ctx.listRecordsWithoutDrain(host.id);
          const record = records.find((row) => row.id === recordId);
          expect(record).toBeDefined();
          expect(record?.fields[lookupId] ?? null).toEqual(displayed);
          expect(record?.fields[conditionalId] ?? null).toEqual(displayedConditional);
        };

        await assertValues(
          linked.id,
          isMultiple ? [bob, alice] : [alice],
          isMultiple ? [bob, alice] : [alice],
          isMultiple ? [displayedBob, displayedAlice] : [displayedAlice],
          isMultiple ? [displayedBob, displayedAlice] : [displayedAlice]
        );
        await assertValues(empty.id, null, null, null, null);

        // Changing the dependency exercises computed UPDATE ... RETURNING, not a direct user write.
        await ctx.updateRecord(host.id, linked.id, {
          [hostKeyId]: 'second',
          [linkId]: { id: second.id },
        });
        await assertValues(
          linked.id,
          isMultiple ? [alice, bob] : [bob],
          isMultiple ? [alice, bob] : [bob],
          isMultiple ? [displayedAlice, displayedBob] : [displayedBob],
          isMultiple ? [displayedAlice, displayedBob] : [displayedBob]
        );
        await ctx.updateRecord(host.id, linked.id, {
          [hostKeyId]: 'unmatched',
          [linkId]: null,
        });
        await assertValues(linked.id, null, null, null, null);

        const unchangedSource = await sql<{ value: unknown }>`
          SELECT ${sql.ref(sourceColumn)} AS value
          FROM ${sql.table(`${ctx.baseId}.${source.id}`)} WHERE "__id" = ${first.id}
        `.execute(ctx.testContainer.db);
        expect(unchangedSource.rows).toEqual([{ value: firstLegacy }]);
      } finally {
        await ctx.drainOutbox().catch(() => undefined);
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (sourceTableId) await ctx.deleteTable(sourceTableId).catch(() => undefined);
        vi.unstubAllEnvs();
      }
    }
  );
});
