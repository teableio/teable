/* eslint-disable @typescript-eslint/naming-convention */
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { getPermissions, IdPrefix, isRobot, TemplatePermissions, type Action } from '@teable/core';
import { CollaboratorType } from '@teable/openapi';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { IDataDbRoutingSnapshot } from '../../global/data-db-client-manager.service';
import { getMaxLevelRole } from '../../utils/get-max-level-role';

/** This projection belongs to query admission, not to the Table domain or a second connection pool. */
export interface IDataQueryAdmissionDb
  extends Pick<V1TeableDatabase, 'base' | 'space' | 'space_data_db_binding'> {
  collaborator: V1TeableDatabase['collaborator'] & { role_name: string };
  template: { id: string; snapshot: string | null };
  data_db_connection: {
    id: string;
    status: string;
    encrypted_url: string;
    internal_schema: string;
    url_fingerprint: string;
    display_host: string | null;
    display_database: string | null;
  };
  access_token: {
    id: string;
    user_id: string;
    client_id: string | null;
    scopes: string;
    space_ids: string | null;
    base_ids: string | null;
    has_full_access: boolean | null;
  };
}

export interface IDataQueryAdmissionPrincipal {
  readonly actorId: string;
  readonly departmentIds: readonly string[];
  readonly tempAuthBaseId?: string;
  readonly accessTokenId?: string;
}

export interface IDataQueryAdmission extends IDataDbRoutingSnapshot {
  readonly permissions: Action[];
  readonly template?: { id: string; baseId: string };
}

type RoleRow = { resourceId: string; roleName: string };

const rolePermissions = (roles: RoleRow[], resourceId: string): Action[] => {
  const matches = roles.filter((role) => role.resourceId === resourceId);
  return matches.length ? getPermissions(getMaxLevelRole(matches)) : [];
};

const stringArray = (value: string | null): string[] => {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('Invalid query admission metadata');
  }
  return parsed;
};

/**
 * One statement reads active ancestry, template classification, collaborator roles, credential
 * ceilings and the trusted data-database binding. Row/field policy and route resolution stay separate.
 */
async function readAdmissionMetadata(
  db: Kysely<IDataQueryAdmissionDb>,
  baseId: string,
  principal: IDataQueryAdmissionPrincipal,
  internal: boolean
) {
  // Robot IDs are shared across tenants and must never gain authority from collaborator rows.
  const principalIds = [principal.actorId, ...principal.departmentIds].filter((id) => !isRobot(id));
  return db
    .selectFrom('base as b')
    .innerJoin('space as s', 's.id', 'b.space_id')
    .leftJoin('space_data_db_binding as binding', 'binding.space_id', 's.id')
    .leftJoin('data_db_connection as connection', (join) =>
      join
        .onRef('connection.id', '=', 'binding.data_db_connection_id')
        .on('binding.mode', '!=', 'default')
    )
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('template as t')
          .select([
            't.id as templateId',
            sql<string | null>`${sql.ref('t.snapshot')}::jsonb ->> 'baseId'`.as('templateBaseId'),
          ])
          // Preserve the legacy literal substring match, including imported snapshot contents.
          // Unlike an unescaped LIKE pattern, strpos cannot treat '_' or '%' in IDs as wildcards.
          .where(sql<boolean>`${internal} and strpos(${sql.ref('t.snapshot')}, ${baseId}) > 0`)
          .limit(1)
          .as('template'),
      (join) => join.onTrue()
    )
    .leftJoin('access_token as token', (join) =>
      join.on(sql<boolean>`${sql.ref('token.id')} = ${principal.accessTokenId ?? null}`)
    )
    .select((eb) => [
      'b.space_id as spaceId',
      'binding.id as bindingId',
      'binding.mode as bindingMode',
      'binding.state as bindingState',
      'connection.id as connectionId',
      'connection.status as connectionStatus',
      'connection.encrypted_url as encryptedUrl',
      'connection.internal_schema as internalSchema',
      'connection.url_fingerprint as urlFingerprint',
      'connection.display_host as displayHost',
      'connection.display_database as displayDatabase',
      sql<boolean>`${sql.ref('b.deleted_time')} is null and ${sql.ref('s.deleted_time')} is null`.as(
        'active'
      ),
      'template.templateId',
      'template.templateBaseId',
      'token.id as tokenId',
      'token.scopes as tokenScopes',
      'token.space_ids as tokenSpaceIds',
      'token.base_ids as tokenBaseIds',
      'token.has_full_access as tokenFullAccess',
      'token.client_id as tokenClientId',
      jsonArrayFrom(
        eb
          .selectFrom('collaborator as c')
          .select(['c.resource_id as resourceId', 'c.role_name as roleName'])
          .where('c.resource_id', 'in', [eb.ref('b.id'), eb.ref('s.id')])
          .where('c.principal_id', 'in', principalIds.length ? principalIds : [''])
          .where(sql<boolean>`${!internal && principalIds.length > 0}`)
      ).as('roles'),
      eb
        .exists(
          eb
            .selectFrom('collaborator as consent')
            .select('consent.id')
            .where(sql<boolean>`${Boolean(principal.accessTokenId)}`)
            .where((q) =>
              q.or([
                q('consent.principal_id', '=', q.ref('token.user_id')),
                ...(principal.departmentIds.length
                  ? [q('consent.principal_id', 'in', [...principal.departmentIds])]
                  : []),
              ])
            )
            .where((q) =>
              q.or([
                q.and([
                  q('consent.resource_type', '=', CollaboratorType.Base),
                  q('consent.resource_id', '=', q.ref('b.id')),
                ]),
                q.and([
                  q('consent.resource_type', '=', CollaboratorType.Space),
                  q('consent.resource_id', '=', q.ref('s.id')),
                ]),
              ])
            )
        )
        .as('oauthResourceAccess'),
    ])
    .where('b.id', '=', baseId)
    .executeTakeFirst();
}

function restrictTokenPermissions(
  row: NonNullable<Awaited<ReturnType<typeof readAdmissionMetadata>>>,
  baseId: string,
  permissions: Action[]
): Action[] {
  if (!row.tokenId || row.tokenScopes === null) throw new UnauthorizedException();
  // OAuth follows current collaboration, not PAT ranges or hasFullAccess.
  const resourceAllowed = row.tokenClientId?.startsWith(IdPrefix.OAuthClient)
    ? row.oauthResourceAccess
    : row.tokenFullAccess ||
      stringArray(row.tokenBaseIds).includes(baseId) ||
      stringArray(row.tokenSpaceIds).includes(row.spaceId);
  if (!resourceAllowed) throw new ForbiddenException();
  const scopes = new Set(stringArray(row.tokenScopes));
  const effectivePermissions = permissions.filter((permission) => scopes.has(permission));
  if (!effectivePermissions.includes('record|read')) throw new ForbiddenException();
  return effectivePermissions;
}

export async function admitDataQueryResource(
  db: Kysely<IDataQueryAdmissionDb>,
  baseId: string,
  principal: IDataQueryAdmissionPrincipal
): Promise<IDataQueryAdmission> {
  const internal = principal.tempAuthBaseId === baseId;
  const row = await readAdmissionMetadata(db, baseId, principal, internal);

  if (!row || !row.active) throw new NotFoundException();
  const template =
    internal && row.templateId ? { id: row.templateId, baseId: row.templateBaseId! } : undefined;
  if (template && typeof template.baseId !== 'string') {
    throw new Error('Invalid query admission template metadata');
  }
  const permissions = internal
    ? template
      ? TemplatePermissions
      : getPermissions('owner')
    : [
        ...new Set([
          ...rolePermissions(row.roles, baseId),
          ...rolePermissions(row.roles, row.spaceId),
        ]),
      ];

  if (!permissions.includes('record|read')) throw new ForbiddenException();
  const effectivePermissions = principal.accessTokenId
    ? restrictTokenPermissions(row, baseId, permissions)
    : permissions;
  return {
    spaceId: row.spaceId,
    permissions: effectivePermissions,
    binding:
      row.bindingId === null
        ? null
        : {
            mode: row.bindingMode!,
            state: row.bindingState!,
            dataDbConnection:
              row.connectionId === null
                ? null
                : {
                    id: row.connectionId,
                    status: row.connectionStatus!,
                    encryptedUrl: row.encryptedUrl!,
                    internalSchema: row.internalSchema!,
                    urlFingerprint: row.urlFingerprint,
                    displayHost: row.displayHost,
                    displayDatabase: row.displayDatabase,
                  },
          },
    ...(template ? { template } : {}),
  };
}
