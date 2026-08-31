import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import { err, type Result } from 'neverthrow';

import type { ComputedUpdateRuntimeConfig } from './ComputedUpdateRuntimeConfig';

type StatementTimeoutSetting = {
  value: string;
  milliseconds: string | number;
};

export const withInlineComputedStatementTimeout = async <T>(
  context: IExecutionContext,
  config: ComputedUpdateRuntimeConfig,
  execute: () => Promise<Result<T, DomainError>>
): Promise<Result<T, DomainError>> => {
  const timeoutMs = Math.max(0, Math.trunc(config.inlineStatementTimeoutMs));
  if (timeoutMs <= 0) return execute();

  const trx = getPostgresTransaction<V1TeableDatabase>(context);
  if (!trx) return execute();

  let previousTimeout: string;

  try {
    const settings = await sql<StatementTimeoutSetting>`
      select
        current_setting('statement_timeout') as value,
        setting::bigint as milliseconds
      from pg_catalog.pg_settings
      where name = 'statement_timeout'
    `.execute(trx);
    const setting = settings.rows[0];
    if (!setting) throw new Error('statement_timeout setting is unavailable');

    previousTimeout = setting.value;
    const currentTimeoutMs = Number(setting.milliseconds);
    const effectiveTimeoutMs =
      Number.isFinite(currentTimeoutMs) && currentTimeoutMs > 0
        ? Math.min(currentTimeoutMs, timeoutMs)
        : timeoutMs;
    await sql`select set_config('statement_timeout', ${`${effectiveTimeoutMs}ms`}, true)`.execute(
      trx
    );
  } catch (error) {
    return err(
      domainError.infrastructure({
        message: `Failed to set inline computed statement timeout: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    );
  }

  try {
    return await execute();
  } finally {
    // A timed-out statement can leave the transaction aborted, so restoring may
    // itself fail. Never hide the original computed result/error in that case.
    try {
      await sql`select set_config('statement_timeout', ${previousTimeout}, true)`.execute(trx);
    } catch {
      // Best effort; PostgreSQL will restore SET LOCAL automatically at transaction end.
    }
  }
};
