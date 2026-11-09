import {
  domainError,
  type DomainError,
  type IUserLookupService,
  type UserIdentityPair,
  type UserLookupRecord,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { buildUserAvatarUrl } from '../../shared/userAvatarUrl';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import {
  buildTableUserScopeSql,
  hasTableUserDepartmentRelations,
} from '../query-builder/tableUserScopeSql';

// Each identifier is bound three times (id / email / name), while tableId is
// bound twice. Keep each query comfortably below PostgreSQL's 65,535 bind
// parameter limit and leave room for the query to evolve.
const TABLE_USER_IDENTIFIER_BATCH_SIZE = 10_000;

@injectable()
export class PostgresUserLookupService implements IUserLookupService {
  private hasOrgDepartmentTables: boolean | undefined;

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async listTableUsersByIdentifiers(
    tableId: string,
    identifiers: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>> {
    const unique = [...new Set(identifiers.filter(Boolean))];
    if (unique.length === 0) {
      return ok([]);
    }

    try {
      // The same user can match different identifiers in different batches;
      // collect ids so batching does not introduce duplicate results.
      const matchedUserIds = new Set<string>();
      const scopeCte = buildTableUserScopeSql(tableId, await this.detectOrgDepartmentTables());

      for (let offset = 0; offset < unique.length; offset += TABLE_USER_IDENTIFIER_BATCH_SIZE) {
        const batch = unique.slice(offset, offset + TABLE_USER_IDENTIFIER_BATCH_SIZE);
        const identifierList = sql.join(batch.map((value) => sql`${value}`));

        // Pushed-down query mirroring v1 typecast semantics: only collaborators
        // of the table's base or space are eligible, matched by id / email /
        // name (v1 matchUser ignores phone, so it is not matched here either).
        // The collaborator join keeps the users scan bounded to a small
        // principal set instead of the whole users table. In enterprise
        // deployments collaborators can also be departments (including
        // ancestors via the department path), expanded to member users — same
        // shape as the EE v1 getUserCollaboratorsBuilder.
        const query = sql<{ id: string }>`
          with ${scopeCte}
          select distinct u.id
          from users u
          join eligible_users e on e.user_id = u.id
          where u.deleted_time is null
            and (
              u.id in (${identifierList})
              or u.email in (${identifierList})
              or u.name in (${identifierList})
            )
          order by u.id
        `;

        const { rows } = await query.execute(this.db);
        for (const row of rows) {
          matchedUserIds.add(row.id);
        }
      }

      if (matchedUserIds.size === 0) {
        return ok([]);
      }

      // The final read re-checks eligibility in the same statement that returns
      // the profile, and lets PostgreSQL perform the cross-batch ordering
      // (JavaScript string comparison does not necessarily match the database
      // collation).
      const { rows } = await sql<{ id: string; name: string; email: string | null }>`
        with ${scopeCte}
        select distinct u.id, u.name, u.email
        from users u
        join eligible_users e on e.user_id = u.id
        where u.deleted_time is null
          and u.id = any(${sql.val([...matchedUserIds])}::text[])
        order by u.id
      `.execute(this.db);
      return ok(rows.map((row) => this.toRecord(row)));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to lookup users',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }

  async listUsersByIdentityPairs(
    pairs: ReadonlyArray<UserIdentityPair>
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>> {
    if (pairs.length === 0) return ok([]);
    try {
      const users = new Map<string, UserLookupRecord>();
      for (let offset = 0; offset < pairs.length; offset += TABLE_USER_IDENTIFIER_BATCH_SIZE) {
        const batch = pairs.slice(offset, offset + TABLE_USER_IDENTIFIER_BATCH_SIZE);
        const values = sql.join(batch.map(({ id, email }) => sql`(${id}, ${email})`));
        const { rows } = await sql<{ id: string; name: string; email: string | null }>`
          SELECT DISTINCT u.id, u.name, u.email
          FROM users u
          JOIN (VALUES ${values}) AS input(id, email)
            ON u.id COLLATE "C" = input.id COLLATE "C"
            AND u.email COLLATE "C" = input.email COLLATE "C"
          WHERE u.deleted_time IS NULL
        `.execute(this.db);
        for (const row of rows) users.set(row.id, this.toRecord(row));
      }
      return ok([...users.values()]);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to lookup users',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }

  private async detectOrgDepartmentTables(): Promise<boolean> {
    if (this.hasOrgDepartmentTables === undefined) {
      this.hasOrgDepartmentTables = await hasTableUserDepartmentRelations(this.db);
    }
    return this.hasOrgDepartmentTables;
  }

  async listUsersByIds(
    ids: ReadonlyArray<string>,
    options?: { includeDeleted?: boolean }
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) {
      return ok([]);
    }

    try {
      const rows = await this.db
        .selectFrom('users')
        .select(['id', 'name', 'email'])
        .where('id', 'in', unique)
        .$if(!options?.includeDeleted, (qb) => qb.where('deleted_time', 'is', null))
        .execute();

      return ok(rows.map((row) => this.toRecord(row)));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to lookup users',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }

  private toRecord(row: { id: string; name: string; email: string | null }): UserLookupRecord {
    return {
      id: row.id,
      name: row.name,
      email: row.email ?? null,
      avatarUrl: buildUserAvatarUrl(row.id),
    };
  }
}
