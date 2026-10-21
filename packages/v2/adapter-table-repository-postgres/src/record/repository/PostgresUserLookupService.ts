import {
  domainError,
  type DomainError,
  type IUserLookupService,
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
      // Single pushed-down query mirroring v1 typecast semantics: only
      // collaborators of the table's base or space are eligible, matched by
      // id / email / name (v1 matchUser ignores phone, so it is not matched
      // here either). The collaborator join keeps the users scan bounded to
      // a small principal set instead of the whole users table.
      // In enterprise deployments collaborators can also be departments
      // (including ancestors via the department path), expanded to member
      // users — same shape as the EE v1 getUserCollaboratorsBuilder.
      const identifierList = sql.join(unique.map((value) => sql`${value}`));
      const departmentBranch = (await this.detectOrgDepartmentTables())
        ? sql`
            union
            select oud.user_id
            from collaborator c
            join organization_department od
              on c.principal_id = od.id
              or od.path @> jsonb_build_array(c.principal_id)
            join organization_user_department oud on od.id = oud.department_id
            where c.resource_id in (select resource_id from scope_ids)
              and c.principal_type = 'department'
          `
        : sql``;

      const query = sql<{ id: string; name: string; email: string | null }>`
        with scope_ids as (
          select tm.base_id as resource_id from table_meta tm where tm.id = ${tableId}
          union
          select b.space_id
          from table_meta tm
          join base b on b.id = tm.base_id
          where tm.id = ${tableId}
        ),
        eligible_users as (
          select c.principal_id as user_id
          from collaborator c
          where c.resource_id in (select resource_id from scope_ids)
            and c.principal_type = 'user'
          ${departmentBranch}
        )
        select distinct u.id, u.name, u.email
        from users u
        join eligible_users e on e.user_id = u.id
        where u.deleted_time is null
          and (
            u.id in (${identifierList})
            or u.email in (${identifierList})
            or u.name in (${identifierList})
          )
      `;

      const { rows } = await query.execute(this.db);
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

  private async detectOrgDepartmentTables(): Promise<boolean> {
    if (this.hasOrgDepartmentTables === undefined) {
      const { rows } = await sql<{ dept: string | null; membership: string | null }>`
        select
          to_regclass('organization_department') as dept,
          to_regclass('organization_user_department') as membership
      `.execute(this.db);
      this.hasOrgDepartmentTables = Boolean(rows[0]?.dept && rows[0]?.membership);
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
