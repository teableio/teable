import { PostgresUnitOfWorkTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { ActorId, BaseId, FieldId, RecordId, TableId, ok } from '@teable/v2-core';
import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan, ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import { SyncInTransactionStrategy } from './SyncInTransactionStrategy';

describe('SyncInTransactionStrategy', () => {
  it('scopes the inline statement timeout to computed execution', async () => {
    const { db } = await createPGliteDb();

    try {
      await db.transaction().execute(async (trx) => {
        const acquireLocks = vi.fn().mockImplementation(async () => {
          const timeout = await sql<{
            value: string;
          }>`select current_setting('statement_timeout') as value`.execute(trx);
          expect(timeout.rows[0]?.value).toBe('12s');
          return ok({});
        });
        const execute = vi.fn().mockResolvedValue(ok({ traceInfos: [], changesByStep: [] }));
        const collectDirtySeedGroups = vi
          .fn()
          .mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
        const updater = {
          acquireLocks,
          execute,
          collectDirtySeedGroups,
        } as unknown as ComputedFieldUpdater;
        const planner = {} as ComputedUpdatePlanner;
        const plan: ComputedUpdatePlan = {
          baseId: BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap(),
          seedTableId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
          seedRecordIds: [RecordId.create(`rec${'c'.repeat(16)}`)._unsafeUnwrap()],
          extraSeedRecords: [],
          steps: [
            {
              tableId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
              fieldIds: [FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap()],
              level: 0,
            },
          ],
          edges: [],
          estimatedComplexity: 1,
          changeType: 'update',
          sameTableBatches: [],
        };
        const strategy = new SyncInTransactionStrategy(planner, {
          inlineStatementTimeoutMs: 12_000,
        });

        const result = await strategy.execute(updater, plan, {
          actorId: ActorId.create('usr_test')._unsafeUnwrap(),
          transaction: new PostgresUnitOfWorkTransaction(trx, 'data'),
        });

        expect(result.isOk()).toBe(true);
        expect(acquireLocks).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        const restored = await sql<{
          value: string;
        }>`select current_setting('statement_timeout') as value`.execute(trx);
        expect(restored.rows[0]?.value).toBe('0');
      });
    } finally {
      await db.destroy();
    }
  });
});
