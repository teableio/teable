import {
  domainError,
  type DomainError,
  type IUserLookupService,
  type UserLookupRecord,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';

@injectable()
export class PostgresUserLookupService implements IUserLookupService {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async listUsersByIdentifiers(
    identifiers: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>> {
    const unique = [...new Set(identifiers.filter(Boolean))];
    if (unique.length === 0) {
      return ok([]);
    }

    try {
      const rows = await this.db
        .selectFrom('users')
        .select(['id', 'name', 'email'])
        .where((eb) =>
          eb.or([eb('id', 'in', unique), eb('email', 'in', unique), eb('name', 'in', unique)])
        )
        .execute();

      return ok(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email ?? null,
        }))
      );
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to lookup users',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }
}
