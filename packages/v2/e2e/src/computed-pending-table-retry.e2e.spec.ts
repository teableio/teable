/**
 * Sanitized structure-equivalent of T6904: a seed computed task that
 * runs while the seed table is mid-schema (`provision_state=pending`)
 * must retry, not obsolete_plan dead-letter.
 *
 * Retained structure: source number field, cross-table lookup, seed
 * outbox task, pending provision flip, then ready drain. No customer
 * identifiers or values.
 */
import { sql } from 'kysely';
import { getRandomString, v2CoreTokens, type IHasher } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  v2RecordRepositoryPostgresTokens,
  type IComputedUpdateOutbox,
} from '../../adapter-table-repository-postgres/src';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

describe('computed tasks retry pending provision tables (e2e)', () => {
  let ctx: SharedTestContext;

  const setProvisionState = async (tableId: string, state: 'pending' | 'ready') => {
    await sql`
      UPDATE "table_meta"
      SET "provision_state" = ${state}
      WHERE "id" = ${tableId}
    `.execute(ctx.testContainer.metaDb);
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 60000);

  it('does not dead-letter a seed task while the seed table is pending', async () => {
    const previousWait = process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
    process.env.V2_TABLE_PROVISION_READY_WAIT_MS = '200';
    process.env.V2_TABLE_PROVISION_READY_POLL_MS = '50';

    let sourceTableId: string | undefined;
    let targetTableId: string | undefined;
    const runId = `run_pending_${getRandomString(12)}`;

    try {
      const sourceNameFieldId = createFieldId();
      const sourceValueFieldId = createFieldId();
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Pending source ${getRandomString(6)}`,
        fields: [
          { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: sourceValueFieldId, name: 'Quantity' },
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;

      const sourceRecord = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Source row',
        [sourceValueFieldId]: 4,
      });

      const targetNameFieldId = createFieldId();
      const targetLinkFieldId = createFieldId();
      const targetLookupFieldId = createFieldId();
      const targetTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Pending target ${getRandomString(6)}`,
        fields: [
          { type: 'singleLineText', id: targetNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: targetLinkFieldId,
            name: 'Source',
            options: {
              relationship: 'manyOne',
              isOneWay: true,
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: targetLookupFieldId,
            name: 'Lookup quantity',
            options: {
              linkFieldId: targetLinkFieldId,
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceValueFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      targetTableId = targetTable.id;

      const targetRecord = await ctx.createRecord(targetTable.id, {
        [targetNameFieldId]: 'Target row',
        [targetLinkFieldId]: { id: sourceRecord.id },
      });
      await ctx.drainOutbox();

      await ctx.updateRecord(sourceTable.id, sourceRecord.id, {
        [sourceValueFieldId]: 9,
      });

      const hasher = ctx.testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);
      const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const enqueueResult = await outbox.enqueueSeedTask({
        taskType: 'seed',
        baseId: ctx.baseId,
        seedTableId: sourceTable.id,
        seedRecordIds: [sourceRecord.id],
        extraSeedRecords: [],
        beforeImageRecords: [],
        changedFieldIds: [sourceValueFieldId],
        changeType: 'update',
        impact: {
          valueFieldIds: [sourceValueFieldId],
          linkFieldIds: [],
        },
        runId,
        planHash: hasher.sha256(`pending-seed-${runId}`),
      });
      if (enqueueResult.isErr()) {
        throw new Error(enqueueResult.error.message);
      }

      await setProvisionState(sourceTable.id, 'pending');

      const processedWhilePending = await ctx.testContainer.processOutbox();
      const pendingDeadLetters = await ctx.testContainer.dataDb
        .selectFrom('computed_update_dead_letter')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('run_id', '=', runId)
        .executeTakeFirstOrThrow();
      const pendingOutbox = await ctx.testContainer.dataDb
        .selectFrom('computed_update_outbox')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('run_id', '=', runId)
        .executeTakeFirstOrThrow();

      expect(Number(pendingDeadLetters.count)).toBe(0);
      expect(Number(pendingOutbox.count)).toBeGreaterThan(0);
      expect(processedWhilePending).toBeGreaterThanOrEqual(0);
      await setProvisionState(sourceTable.id, 'ready');
      const delay = Promise.withResolvers<void>();
      setTimeout(delay.resolve, 400);
      await delay.promise;
      await ctx.testContainer.processOutbox();
      await ctx.drainOutbox();

      const afterDeadLetters = await ctx.testContainer.dataDb
        .selectFrom('computed_update_dead_letter')
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .where('run_id', '=', runId)
        .executeTakeFirstOrThrow();
      expect(Number(afterDeadLetters.count)).toBe(0);

      const targetRecords = await ctx.listRecordsWithoutDrain(targetTable.id);
      const lookupValue = targetRecords.find((record) => record.id === targetRecord.id)?.fields[
        targetLookupFieldId
      ];
      expect(lookupValue).toEqual([9]);
    } finally {
      if (previousWait == null) {
        delete process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
      } else {
        process.env.V2_TABLE_PROVISION_READY_WAIT_MS = previousWait;
      }
      delete process.env.V2_TABLE_PROVISION_READY_POLL_MS;
      await ctx.testContainer.dataDb
        .deleteFrom('computed_update_outbox')
        .where('run_id', '=', runId)
        .execute();
      await ctx.testContainer.dataDb
        .deleteFrom('computed_update_dead_letter')
        .where('run_id', '=', runId)
        .execute();
      if (targetTableId) {
        await ctx.deleteTable(targetTableId, { mode: 'permanent' }).catch(() => undefined);
      }
      if (sourceTableId) {
        await ctx.deleteTable(sourceTableId, { mode: 'permanent' }).catch(() => undefined);
      }
    }
  }, 120000);
});
