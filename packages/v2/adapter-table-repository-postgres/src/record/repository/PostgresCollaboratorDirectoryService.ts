import {
  domainError,
  type CollaboratorDirectoryUser,
  type DomainError,
  type ICollaboratorDirectoryService,
  type IExecutionContext,
  type BaseId,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';

@injectable()
export class PostgresCollaboratorDirectoryService implements ICollaboratorDirectoryService {
  private hasOrgDepartmentTables: boolean | undefined;

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.metaDb)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async listBaseUsers(
    _context: IExecutionContext,
    baseId: BaseId,
    options: Parameters<ICollaboratorDirectoryService['listBaseUsers']>[2]
  ): Promise<Result<ReadonlyArray<CollaboratorDirectoryUser>, DomainError>> {
    try {
      const base = await this.db
        .selectFrom('base')
        .select('space_id')
        .where('id', '=', baseId.toString())
        .executeTakeFirst();
      if (!base) {
        return err(
          domainError.notFound({
            code: 'base.not_found',
            message: `Base not found: ${baseId.toString()}`,
          })
        );
      }

      const departmentBranch = (await this.detectOrgDepartmentTables())
        ? sql`
            union all
            select oud.user_id, c.created_time
            from collaborator c
            join organization_department od
              on c.principal_id = od.id
              or od.path @> jsonb_build_array(c.principal_id)
            join organization_user_department oud on od.id = oud.department_id
            where c.resource_id in (select resource_id from scope_ids)
              and c.principal_type = 'department'
          `
        : sql``;
      const searchClause = options.search ? sql`and u.name ilike ${`%${options.search}%`}` : sql``;
      const query = sql<{ id: string; name: string; avatar: string | null }>`
        with scope_ids as (
          select ${baseId.toString()}::text as resource_id
          union
          select ${base.space_id}::text
        ),
        eligible_users as (
          select c.principal_id as user_id, c.created_time
          from collaborator c
          where c.resource_id in (select resource_id from scope_ids)
            and c.principal_type = 'user'
          ${departmentBranch}
        )
        select u.id, u.name, u.avatar
        from eligible_users e
        join users u on u.id = e.user_id
        where (u.is_system is null or u.is_system = false)
        ${searchClause}
        group by u.id, u.name, u.avatar
        order by max(e.created_time) desc
        offset ${options.pagination.offset().toNumber()}
        limit ${options.pagination.limit().toNumber()}
      `;
      const { rows } = await query.execute(this.db);
      return ok(rows.map(PostgresCollaboratorDirectoryService.mapUser));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to list base collaborators',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }

  async listUsersByIds(
    _context: IExecutionContext,
    userIds: ReadonlyArray<string>,
    options: Parameters<ICollaboratorDirectoryService['listUsersByIds']>[2]
  ): Promise<Result<ReadonlyArray<CollaboratorDirectoryUser>, DomainError>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueIds.length) return ok([]);

    try {
      let query = this.db
        .selectFrom('users')
        .select(['id', 'name', 'avatar'])
        .where('id', 'in', uniqueIds)
        .offset(options.pagination.offset().toNumber())
        .limit(options.pagination.limit().toNumber());
      if (options.search) {
        query = query.where('name', 'ilike', `%${options.search}%`);
      }
      const rows = await query.execute();
      return ok(rows.map(PostgresCollaboratorDirectoryService.mapUser));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to list referenced collaborators',
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

  private static mapUser(row: {
    readonly id: string;
    readonly name: string;
    readonly avatar: string | null;
  }): CollaboratorDirectoryUser {
    return { id: row.id, name: row.name, avatar: row.avatar };
  }
}
