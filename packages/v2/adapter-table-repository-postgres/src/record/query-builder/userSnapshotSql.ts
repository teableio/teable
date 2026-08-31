import { FieldType, type DomainError, type Field } from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';
import { ok, type Result } from 'neverthrow';

import { buildUserAvatarUrl } from '../../shared/userAvatarUrl';

type InnerFieldHost = Field & {
  innerField?: () => Result<Field, DomainError>;
};

const unwrapLookupPresentation = (field: Field): Field => {
  const fieldType = field.type();
  if (!fieldType.equals(FieldType.lookup()) && !fieldType.equals(FieldType.conditionalLookup())) {
    return field;
  }
  const inner = (field as InnerFieldHost).innerField?.();
  return inner?.isOk() ? unwrapLookupPresentation(inner.value) : field;
};

/**
 * User-group identity applies to plain user fields and to lookups whose
 * presentation type is user. Snapshot extras (email/avatar) must not split
 * one collaborator into multiple group buckets or date-sort runs.
 * Returns the cell multiplicity of the outer field, or null when the field
 * is not user-identity grouped.
 */
export const resolveUserGroupIdentityMultiplicity = (
  field: Field
): Result<boolean | null, DomainError> => {
  const presentation = unwrapLookupPresentation(field);
  if (!presentation.type().equals(FieldType.user())) {
    return ok(null);
  }
  return field.isMultipleCellValue().map((multiplicity) => multiplicity.isMultiple());
};

export interface UserSnapshotActorFallback {
  actorId: string;
  actorName?: string | null;
  actorEmail?: string | null;
}

const scalarTextFromJsonSql = (jsonExpr: string): string => `(${jsonExpr} #>> '{}')`;

const buildUserSnapshotObjectSql = (snapshotRef: string): string => {
  const snapshotJson = `to_jsonb(${snapshotRef})`;
  const scalarText = scalarTextFromJsonSql(snapshotJson);
  return `(CASE
    WHEN ${snapshotRef} IS NULL THEN NULL::jsonb
    WHEN jsonb_typeof(${snapshotJson}) = 'object' THEN ${snapshotJson}
    ELSE jsonb_build_object('id', ${scalarText}, 'title', ${scalarText})
  END)`;
};

export const buildUserTitleFromSnapshotSql = (
  snapshotRef: string,
  idFallbackRef?: string
): string => {
  const snapshotObject = buildUserSnapshotObjectSql(snapshotRef);
  const fallback = idFallbackRef ?? `${snapshotObject}->>'id'`;
  return `COALESCE(${snapshotObject}->>'title', ${snapshotObject}->>'name', ${snapshotObject}->>'id', ${fallback})`;
};

export const buildUserJsonObjectFromSnapshotSql = (
  snapshotRef: string,
  idFallbackRef?: string
): string => {
  const snapshotObject = buildUserSnapshotObjectSql(snapshotRef);
  const fallback = idFallbackRef ?? `${snapshotObject}->>'id'`;
  const fallbackIsNull = idFallbackRef ? `${idFallbackRef} IS NULL` : 'TRUE';
  return `jsonb_strip_nulls(
    CASE
      WHEN ${snapshotObject} IS NULL AND ${fallbackIsNull} THEN NULL::jsonb
      ELSE COALESCE(
        ${snapshotObject},
        jsonb_build_object('id', ${fallback}, 'title', ${fallback})
      ) || jsonb_build_object(
        'id', COALESCE(${snapshotObject}->>'id', ${fallback}),
        'title', COALESCE(${snapshotObject}->>'title', ${snapshotObject}->>'name', ${snapshotObject}->>'id', ${fallback})
      )
    END
  )`;
};

const buildUserSnapshotObjectExpr = (snapshotExpr: RawBuilder<unknown>): RawBuilder<unknown> => {
  const snapshotJson = sql`to_jsonb(${snapshotExpr})`;
  const scalarText = sql`${snapshotJson} #>> '{}'`;
  return sql`(CASE
    WHEN ${snapshotExpr} IS NULL THEN NULL::jsonb
    WHEN jsonb_typeof(${snapshotJson}) = 'object' THEN ${snapshotJson}
    ELSE jsonb_build_object('id', ${scalarText}, 'title', ${scalarText})
  END)`;
};

const buildActorAwareFallbackObjectExpr = (
  fallbackExpr: RawBuilder<unknown>,
  actorFallback?: UserSnapshotActorFallback
): RawBuilder<unknown> => {
  if (!actorFallback) {
    return sql`jsonb_build_object('id', ${fallbackExpr}, 'title', ${fallbackExpr})`;
  }

  const actorTitle = actorFallback.actorName ?? actorFallback.actorId;
  const actorEmail = actorFallback.actorEmail ?? null;
  const actorAvatarUrl = buildUserAvatarUrl(actorFallback.actorId);
  const actorIdExpr = sql`${actorFallback.actorId}::text`;
  const actorTitleExpr = sql`${actorTitle}::text`;
  const actorEmailExpr = actorEmail == null ? sql`NULL::text` : sql`${actorEmail}::text`;
  const actorAvatarUrlExpr = sql`${actorAvatarUrl}::text`;

  return sql`CASE
    WHEN ${fallbackExpr} = ${actorIdExpr} THEN jsonb_build_object(
      'id', ${actorIdExpr},
      'title', ${actorTitleExpr},
      'email', ${actorEmailExpr},
      'avatarUrl', ${actorAvatarUrlExpr}
    )
    ELSE jsonb_build_object('id', ${fallbackExpr}, 'title', ${fallbackExpr})
  END`;
};

const buildActorAwareTitleExpr = (
  snapshotObject: RawBuilder<unknown>,
  fallbackExpr: RawBuilder<unknown>,
  actorFallback?: UserSnapshotActorFallback
): RawBuilder<unknown> => {
  if (!actorFallback) {
    return sql`COALESCE(${snapshotObject}->>'title', ${snapshotObject}->>'name', ${snapshotObject}->>'id', ${fallbackExpr})`;
  }

  const resolvedId = sql`COALESCE(${snapshotObject}->>'id', ${fallbackExpr})`;
  const snapshotTitle = sql`COALESCE(
    ${snapshotObject}->>'title',
    ${snapshotObject}->>'name',
    ${snapshotObject}->>'id',
    ${fallbackExpr}
  )`;

  const actorTitle = actorFallback.actorName ?? actorFallback.actorId;
  const actorIdExpr = sql`${actorFallback.actorId}::text`;
  const actorTitleExpr = sql`${actorTitle}::text`;
  return sql`CASE
    WHEN ${resolvedId} = ${actorIdExpr}
      AND (${snapshotTitle} IS NULL OR ${snapshotTitle} = ${actorIdExpr})
      THEN ${actorTitleExpr}
    ELSE ${snapshotTitle}
  END`;
};

export const buildUserJsonObjectFromSnapshotExpr = (
  snapshotExpr: RawBuilder<unknown>,
  idFallbackExpr?: RawBuilder<unknown>,
  actorFallback?: UserSnapshotActorFallback
): RawBuilder<unknown> => {
  const snapshotObject = buildUserSnapshotObjectExpr(snapshotExpr);
  const fallback = idFallbackExpr ?? sql`${snapshotObject}->>'id'`;
  const fallbackIsNull = idFallbackExpr ? sql`${idFallbackExpr} IS NULL` : sql`TRUE`;
  const fallbackObject = buildActorAwareFallbackObjectExpr(fallback, actorFallback);
  const title = buildActorAwareTitleExpr(snapshotObject, fallback, actorFallback);
  return sql`jsonb_strip_nulls(
    CASE
      WHEN ${snapshotObject} IS NULL AND ${fallbackIsNull} THEN NULL::jsonb
      ELSE COALESCE(
        ${snapshotObject},
        ${fallbackObject}
      ) || jsonb_build_object(
        'id', COALESCE(${snapshotObject}->>'id', ${fallback}),
        'title', ${title}
      )
    END
  )`;
};

export const buildUserJsonObjectFromSnapshotWithLookupExpr = (
  snapshotExpr: RawBuilder<unknown>,
  idFallbackExpr: RawBuilder<unknown>
): RawBuilder<unknown> => {
  const snapshotObject = buildUserSnapshotObjectExpr(snapshotExpr);
  const lookupObject = sql`(
    SELECT jsonb_strip_nulls(jsonb_build_object(
      'id', u.id,
      'title', COALESCE(u.name, u.id),
      'email', u.email,
      'avatarUrl', '/api/attachments/read/public/avatar/'::text || u.id
    ))
    FROM public.users u
    WHERE u.id = ${idFallbackExpr}::text
    LIMIT 1
  )`;

  return sql`jsonb_strip_nulls(
    CASE
      WHEN ${snapshotObject} IS NULL AND ${idFallbackExpr} IS NULL THEN NULL::jsonb
      ELSE COALESCE(
        ${snapshotObject},
        ${lookupObject},
        jsonb_build_object('id', ${idFallbackExpr}, 'title', ${idFallbackExpr})
      ) || jsonb_build_object(
        'id', COALESCE(${snapshotObject}->>'id', ${lookupObject}->>'id', ${idFallbackExpr}),
        'title', COALESCE(
          ${snapshotObject}->>'title',
          ${snapshotObject}->>'name',
          ${lookupObject}->>'title',
          ${lookupObject}->>'name',
          ${snapshotObject}->>'id',
          ${idFallbackExpr}
        ),
        'email', COALESCE(${snapshotObject}->>'email', ${lookupObject}->>'email'),
        'avatarUrl', COALESCE(${snapshotObject}->>'avatarUrl', ${lookupObject}->>'avatarUrl')
      )
    END
  )`;
};

// User cells persist the collaborator snapshot taken at write time (email,
// avatarUrl, ...), so grouping by the raw column splits one collaborator into
// one bucket per snapshot generation. This expression reduces a cell to its
// presentation identity (id + title), matching the header walk in
// record-open-api-v2's buildGroupQueryExtra. Legacy scalar cells that store a
// bare user id normalize to {id: scalar, title: scalar}, the same convention
// as buildUserSnapshotObjectExpr. Key names stay literal so the expression
// compiles identically in SELECT, GROUP BY and ORDER BY.
export const buildUserGroupIdentityExpr = (
  columnRef: RawBuilder<unknown>,
  isMultiple: boolean
): RawBuilder<unknown> => {
  const columnJson = sql`${columnRef}::jsonb`;
  // one user value (object snapshot or legacy scalar id) to its identity
  const valueIdentity = (valueJson: RawBuilder<unknown>): RawBuilder<unknown> => sql`CASE
    WHEN jsonb_typeof(${valueJson}) = 'object'
      THEN jsonb_build_object('id', ${valueJson} ->> 'id', 'title', ${valueJson} ->> 'title')
    ELSE jsonb_build_object('id', ${valueJson} #>> '{}', 'title', ${valueJson} #>> '{}')
  END`;
  if (isMultiple) {
    // non-array cells (a single object or scalar left behind by a
    // single->multiple conversion) wrap into a one-element array, the same
    // normalization the multiple-user ordering path applies
    return sql`CASE jsonb_typeof(${columnJson})
      WHEN 'array' THEN (
        SELECT jsonb_agg(${valueIdentity(sql`u`)})
        FROM jsonb_array_elements(${columnJson}) AS u
      )
      WHEN 'null' THEN NULL::jsonb
      ELSE CASE
        WHEN ${columnJson} IS NULL THEN NULL::jsonb
        ELSE jsonb_build_array(${valueIdentity(columnJson)})
      END
    END`;
  }
  return sql`CASE jsonb_typeof(${columnJson})
    WHEN 'object' THEN NULLIF(
      jsonb_build_object('id', ${columnJson} ->> 'id', 'title', ${columnJson} ->> 'title'),
      '{"id": null, "title": null}'::jsonb
    )
    WHEN 'null' THEN NULL::jsonb
    ELSE CASE
      WHEN ${columnJson} IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object('id', ${columnJson} #>> '{}', 'title', ${columnJson} #>> '{}')
    END
  END`;
};
