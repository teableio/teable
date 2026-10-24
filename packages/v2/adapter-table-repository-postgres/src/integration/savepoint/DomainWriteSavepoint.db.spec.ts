/* eslint-disable @typescript-eslint/naming-convention */
import { resolvePostgresDbOrTx, v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  domainError,
  v2CoreTokens,
  type IExecutionContext,
  type IUnitOfWork,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

describe('PostgresUnitOfWork.savepoint (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  const setup = async () => {
    const container = getV2NodeTestContainer().container;
    const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);
    const context: IExecutionContext = {
      actorId: ActorId.create('system')._unsafeUnwrap(),
    };
    const tableName = `sp_probe_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

    await sql`create table ${sql.table(tableName)} (id text primary key)`.execute(db);

    const rows = async (executor?: IExecutionContext) => {
      const result = await sql<{ id: string }>`
        select id from ${sql.table(tableName)} order by id
      `.execute(resolvePostgresDbOrTx(db, executor));
      return result.rows.map((row) => row.id);
    };

    const insert = async (executor: IExecutionContext, id: string) => {
      await sql`insert into ${sql.table(tableName)} (id) values (${id})`.execute(
        resolvePostgresDbOrTx(db, executor)
      );
    };

    return { unitOfWork, db, context, rows, insert };
  };

  it('rolls back failed work and keeps the transaction usable', async () => {
    const { unitOfWork, context, rows, insert } = await setup();

    const result = await unitOfWork.withTransaction(context, async (txContext) => {
      await insert(txContext, 'a');

      const savepointResult = await unitOfWork.savepoint!(txContext, async () => {
        await insert(txContext, 'b');
        return err<number, never>(domainError.validation({ message: 'forced failure' }));
      });
      if (savepointResult.isOk()) {
        return err(domainError.unexpected({ message: 'savepoint should have failed' }));
      }

      // A statement after the rollback proves the transaction is not poisoned
      // (Postgres would answer 25P02 here without the savepoint).
      await insert(txContext, 'c');
      return ok(await rows(txContext));
    });

    expect(result._unsafeUnwrap()).toEqual(['a', 'c']);
    expect(await rows()).toEqual(['a', 'c']);
  });

  it('rolls back work that throws', async () => {
    const { unitOfWork, context, rows, insert } = await setup();

    const result = await unitOfWork.withTransaction(context, async (txContext) => {
      await insert(txContext, 'a');
      await expect(
        unitOfWork.savepoint!(txContext, async () => {
          await insert(txContext, 'b');
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      const visible = await rows(txContext);
      return ok(visible);
    });

    expect(result._unsafeUnwrap()).toEqual(['a']);
  });

  it('releases work that succeeds', async () => {
    const { unitOfWork, context, rows, insert } = await setup();

    const result = await unitOfWork.withTransaction(context, async (txContext) => {
      const savepointResult = await unitOfWork.savepoint!(txContext, async () => {
        await insert(txContext, 'kept');
        return ok('done');
      });
      expect(savepointResult._unsafeUnwrap()).toBe('done');
      return ok(await rows(txContext));
    });

    expect(result._unsafeUnwrap()).toEqual(['kept']);
    expect(await rows()).toEqual(['kept']);
  });

  it('requires an active transaction', async () => {
    const { unitOfWork, context } = await setup();

    const result = await unitOfWork.savepoint!(context, async () => ok('unused'));

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.code).toBe('unit_of_work.transaction_required');
  });
});
