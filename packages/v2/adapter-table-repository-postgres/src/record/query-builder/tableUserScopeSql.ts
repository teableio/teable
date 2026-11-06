import { sql, type QueryExecutorProvider } from 'kysely';

export const hasTableUserDepartmentRelations = async (
  db: QueryExecutorProvider
): Promise<boolean> => {
  const { rows } = await sql<{ dept: string | null; membership: string | null }>`
    select
      to_regclass('organization_department') as dept,
      to_regclass('organization_user_department') as membership
  `.execute(db);
  return Boolean(rows[0]?.dept && rows[0]?.membership);
};

/** Metadata-only scope shared by record resolution and schema conversion. */
export const buildTableUserScopeSql = (tableId: string, includeDepartments: boolean) => {
  const departmentBranch = includeDepartments
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

  return sql`
    scope_ids as (
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
  `;
};
