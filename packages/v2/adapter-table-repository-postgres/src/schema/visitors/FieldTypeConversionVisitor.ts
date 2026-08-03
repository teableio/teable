import {
  AbstractFieldVisitor,
  CellValueType,
  DateTimeFormatting,
  DEFAULT_TABLE_DATA_SAFETY_LIMITS,
  NumberFormatting,
  SelectOptionId,
  domainError,
} from '@teable/v2-core';
import {
  type FormulaField,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type Field,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
} from '@teable/v2-core';
import { formatNumberStringSql } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveUserAvatarUrlPrefix } from '../../shared/userAvatarUrl';
import type { TableSchemaStatementBuilder } from '../rules/core';
import type { TableIdentifier } from '../rules/helpers';
import { PostgresTableSchemaFieldCreateVisitor } from './PostgresTableSchemaFieldCreateVisitor';
import { PostgresTableSchemaFieldDeleteVisitor } from './PostgresTableSchemaFieldDeleteVisitor';

export type FieldConversionParams = {
  db: Kysely<V1TeableDatabase>;
  schema: string | null;
  tableName: string;
  tableId: string;
  dbFieldName: string;
  /** Field ID for updating field metadata (e.g., auto-generating select options) */
  fieldId?: string;
  tableLocationsById?: ReadonlyMap<string, TableIdentifier>;
  fieldsById?: ReadonlyMap<string, FieldConversionFieldMetadata>;
};

const createCompiledStatementBuilder = (
  db: Kysely<V1TeableDatabase>,
  sqlText: string
): TableSchemaStatementBuilder => ({
  scope: 'data',
  compile: () => sql.raw(sqlText).compile(db),
});

const quoteIdent = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const ISO_DATE_OR_DATETIME_SQL_REGEX =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?)?$';

const SELECT_CHOICE_NAME_MAX_LENGTH =
  DEFAULT_TABLE_DATA_SAFETY_LIMITS.fieldOptions.maxSelectChoiceNameLength;

const selectChoiceNameLengthError = `Select choice name exceeds ${SELECT_CHOICE_NAME_MAX_LENGTH} characters`;

type SelectChoiceDto = {
  id: string;
  name: string;
  color: string;
};

type FieldConversionFieldMetadata = {
  dbFieldName: string;
  tableId?: string;
  options?: unknown;
};

type LinkMappingMetadata = {
  lookupColumnName: string | null;
  foreignTable: TableIdentifier | null;
  symmetricColumnName?: string | null;
};

type TextUserMapping = {
  lookupValue: string;
  id: string;
  title: string;
  email: string | null;
};

type TableSchemaStatementExecuteContext = Parameters<
  NonNullable<TableSchemaStatementBuilder['execute']>
>[0];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const normalizeChoice = (value: unknown): SelectChoiceDto | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { id, name, color } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof color !== 'string') {
    return undefined;
  }

  return { id, name, color };
};

const normalizeChoices = (options: unknown): SelectChoiceDto[] => {
  const rawOptions = typeof options === 'string' ? tryParseJson(options) : options;
  if (!isRecord(rawOptions) || !Array.isArray(rawOptions.choices)) {
    return [];
  }

  return rawOptions.choices
    .map(normalizeChoice)
    .filter((choice): choice is SelectChoiceDto => Boolean(choice));
};

const buildMergedOptions = (
  currentOptions: unknown,
  generatedChoices: ReadonlyArray<SelectChoiceDto>
): Record<string, unknown> => {
  const parsedOptions =
    typeof currentOptions === 'string' ? tryParseJson(currentOptions) : currentOptions;
  const baseOptions = isRecord(parsedOptions) ? parsedOptions : {};
  return {
    ...baseOptions,
    choices: [...normalizeChoices(parsedOptions), ...generatedChoices],
  };
};

const sqlNullableLiteral = (value: string | null | undefined): string =>
  value == null ? 'NULL' : quoteLiteral(value);

const parseTableIdentifier = (dbTableName: string): TableIdentifier => {
  const [schema, ...rest] = dbTableName.split('.');
  if (rest.length === 0) {
    return { schema: null, tableName: schema ?? dbTableName };
  }

  return { schema: schema ?? null, tableName: rest.join('.') };
};

const buildTableIdentifierDeclarations = (table: TableIdentifier | null): string => {
  const schema = table?.schema ?? (table ? 'public' : null);
  return [
    `  foreign_schema text := ${sqlNullableLiteral(schema)};`,
    `  foreign_name text := ${sqlNullableLiteral(table?.tableName)};`,
  ].join('\n');
};

const createCustomDataStatementBuilder = (
  db: Kysely<V1TeableDatabase>,
  previewSql: string,
  resolveSql: (ctx: TableSchemaStatementExecuteContext) => Promise<string | null>
): TableSchemaStatementBuilder => ({
  scope: 'data',
  compile: () => sql.raw(previewSql).compile(db),
  execute: async (ctx) => {
    const sqlText = await resolveSql(ctx);
    if (!sqlText) {
      return;
    }
    await sql.raw(sqlText).execute(ctx.dataDb);
  },
});

const normalizeFieldOptions = (options: unknown): Record<string, unknown> => {
  const parsed = typeof options === 'string' ? tryParseJson(options) : options;
  return isRecord(parsed) ? parsed : {};
};

const getKnownFieldMetadata = (
  params: FieldConversionParams,
  fieldId: string
): FieldConversionFieldMetadata | undefined => params.fieldsById?.get(fieldId);

const getKnownFieldDbName = (params: FieldConversionParams, fieldId: string): string | null =>
  getKnownFieldMetadata(params, fieldId)?.dbFieldName ?? null;

const getKnownTableIdentifier = (
  params: FieldConversionParams,
  tableId: string
): TableIdentifier | null => params.tableLocationsById?.get(tableId) ?? null;

const getPreviewFieldDbName = (params: FieldConversionParams, fieldId: string): string =>
  getKnownFieldDbName(params, fieldId) ?? fieldId;

const getPreviewTableIdentifier = (
  params: FieldConversionParams,
  tableId: string
): TableIdentifier =>
  getKnownTableIdentifier(params, tableId) ?? { schema: params.schema, tableName: tableId };

const getKnownSymmetricFieldDbName = (
  params: FieldConversionParams,
  foreignTableId: string,
  currentFieldId: string,
  explicitSymmetricFieldId?: string
): string | null => {
  if (explicitSymmetricFieldId) {
    const explicitField = getKnownFieldMetadata(params, explicitSymmetricFieldId);
    if (explicitField?.dbFieldName) {
      return explicitField.dbFieldName;
    }
  }

  for (const [fieldId, field] of params.fieldsById ??
    new Map<string, FieldConversionFieldMetadata>()) {
    if (explicitSymmetricFieldId && fieldId === explicitSymmetricFieldId) {
      return field.dbFieldName;
    }
    if (field.tableId !== foreignTableId) {
      continue;
    }
    const options = normalizeFieldOptions(field.options);
    if (options.symmetricFieldId === currentFieldId) {
      return field.dbFieldName;
    }
  }

  return null;
};

const getPreviewSymmetricFieldDbName = (
  params: FieldConversionParams,
  foreignTableId: string,
  currentFieldId: string,
  explicitSymmetricFieldId?: string
): string | null =>
  getKnownSymmetricFieldDbName(params, foreignTableId, currentFieldId, explicitSymmetricFieldId) ??
  explicitSymmetricFieldId ??
  null;

const getPreviewLinkMappingMetadata = (
  params: FieldConversionParams,
  linkField: LinkField,
  options?: { includeSymmetric?: boolean }
): LinkMappingMetadata => {
  const foreignTableId = linkField.foreignTableId().toString();
  const currentFieldId = linkField.id().toString();
  return {
    lookupColumnName: getPreviewFieldDbName(params, linkField.lookupFieldId().toString()),
    foreignTable: getPreviewTableIdentifier(params, foreignTableId),
    ...(options?.includeSymmetric
      ? {
          symmetricColumnName: getPreviewSymmetricFieldDbName(
            params,
            foreignTableId,
            currentFieldId,
            linkField.symmetricFieldId()?.toString()
          ),
        }
      : {}),
  };
};

const fetchFieldDbName = async (
  ctx: TableSchemaStatementExecuteContext,
  fieldId: string
): Promise<string | null> => {
  const rows = await sql<{ db_field_name: string | null }>`
    SELECT db_field_name
    FROM field
    WHERE id = ${fieldId} AND deleted_time IS NULL
    LIMIT 1
  `.execute(ctx.metaDb);

  return rows.rows[0]?.db_field_name ?? null;
};

const fetchTableIdentifier = async (
  ctx: TableSchemaStatementExecuteContext,
  tableId: string
): Promise<TableIdentifier | null> => {
  const rows = await sql<{ db_table_name: string | null }>`
    SELECT db_table_name
    FROM table_meta
    WHERE id = ${tableId} AND deleted_time IS NULL
    LIMIT 1
  `.execute(ctx.metaDb);
  const dbTableName = rows.rows[0]?.db_table_name;
  return dbTableName ? parseTableIdentifier(dbTableName) : null;
};

const fetchSymmetricFieldDbName = async (
  ctx: TableSchemaStatementExecuteContext,
  foreignTableId: string,
  currentFieldId: string,
  explicitSymmetricFieldId?: string
): Promise<string | null> => {
  const explicitClause = explicitSymmetricFieldId
    ? ` OR id = ${quoteLiteral(explicitSymmetricFieldId)}`
    : '';
  const rows = await sql<{ db_field_name: string | null }>`
    SELECT db_field_name
    FROM field
    WHERE table_id = ${foreignTableId}
      AND type = 'link'
      AND deleted_time IS NULL
      AND (
        options::jsonb->>'symmetricFieldId' = ${currentFieldId}
        ${sql.raw(explicitClause)}
      )
    ORDER BY id
    LIMIT 1
  `.execute(ctx.metaDb);

  return rows.rows[0]?.db_field_name ?? null;
};

const fetchLinkMappingMetadata = async (
  ctx: TableSchemaStatementExecuteContext,
  linkField: LinkField,
  options?: { includeSymmetric?: boolean }
): Promise<LinkMappingMetadata> => {
  const foreignTableId = linkField.foreignTableId().toString();
  const currentFieldId = linkField.id().toString();
  const [lookupColumnName, foreignTable, symmetricColumnName] = await Promise.all([
    fetchFieldDbName(ctx, linkField.lookupFieldId().toString()),
    fetchTableIdentifier(ctx, foreignTableId),
    options?.includeSymmetric
      ? fetchSymmetricFieldDbName(
          ctx,
          foreignTableId,
          currentFieldId,
          linkField.symmetricFieldId()?.toString()
        )
      : Promise.resolve(undefined),
  ]);

  return {
    lookupColumnName,
    foreignTable,
    ...(options?.includeSymmetric ? { symmetricColumnName } : {}),
  };
};

const buildTextUserPartsSql = (fullTableName: string, col: string): string => `
  SELECT DISTINCT parts.uid
  FROM ${fullTableName} AS t
  CROSS JOIN LATERAL regexp_split_to_table(t.${col}, ${quoteLiteral(',')})
    WITH ORDINALITY AS raw_parts(part, part_idx)
  CROSS JOIN LATERAL (SELECT trim(raw_parts.part) AS uid) AS parts
  WHERE t.${col} IS NOT NULL AND parts.uid <> ''`;

const fetchTextUserMappings = async (
  ctx: TableSchemaStatementExecuteContext,
  fullTableName: string,
  col: string
): Promise<ReadonlyArray<TextUserMapping>> => {
  const identifierRows = await sql<{ uid: string }>`
    ${sql.raw(buildTextUserPartsSql(fullTableName, col))}
  `.execute(ctx.dataDb);
  const identifiers = [
    ...new Set(identifierRows.rows.map((row) => row.uid).filter((uid) => uid.length > 0)),
  ];
  if (identifiers.length === 0) {
    return [];
  }

  const identifierValues = identifiers
    .map((identifier) => `(${quoteLiteral(identifier)})`)
    .join(', ');
  const userRows = await sql<{ id: string; name: string | null; email: string | null }>`
    WITH input(uid) AS (VALUES ${sql.raw(identifierValues)})
    SELECT DISTINCT users.id, users.name, users.email
    FROM users
    JOIN input ON users.id = input.uid OR users.email = input.uid OR users.name = input.uid
    ORDER BY users.id
  `.execute(ctx.metaDb);

  const byId = new Map<string, Omit<TextUserMapping, 'lookupValue'>>();
  const byEmail = new Map<string, Omit<TextUserMapping, 'lookupValue'>>();
  const byName = new Map<string, Omit<TextUserMapping, 'lookupValue'>>();

  for (const row of userRows.rows) {
    const user = {
      id: row.id,
      title: row.name ?? row.id,
      email: row.email ?? null,
    };
    if (!byId.has(row.id)) {
      byId.set(row.id, user);
    }
    if (row.email && !byEmail.has(row.email)) {
      byEmail.set(row.email, user);
    }
    if (row.name && !byName.has(row.name)) {
      byName.set(row.name, user);
    }
  }

  return identifiers
    .map((identifier) => {
      const user = byId.get(identifier) ?? byEmail.get(identifier) ?? byName.get(identifier);
      return user ? { lookupValue: identifier, ...user } : null;
    })
    .filter((mapping): mapping is TextUserMapping => Boolean(mapping));
};

const buildTextToUserTransformSql = (
  fullTableName: string,
  col: string,
  isMultiple: boolean,
  mappings: ReadonlyArray<TextUserMapping>
): string | null => {
  if (mappings.length === 0) {
    return null;
  }

  const avatarPrefix = resolveUserAvatarUrlPrefix();
  const mappingValues = mappings
    .map(
      (mapping) =>
        `(${quoteLiteral(mapping.lookupValue)}, ${quoteLiteral(mapping.id)}, ${quoteLiteral(
          mapping.title
        )}, ${sqlNullableLiteral(mapping.email)})`
    )
    .join(', ');
  const userJsonBuild = (alias: string) =>
    `jsonb_build_object('id', ${alias}.id, 'title', ${alias}.title, 'email', ${alias}.email, 'avatarUrl', ${quoteLiteral(
      avatarPrefix
    )} || ${alias}.id)`;
  const aggregationSql = isMultiple
    ? `SELECT rid, jsonb_agg(${userJsonBuild('matched_users')} ORDER BY part_idx)::text AS user_json
       FROM matched_users
       GROUP BY rid`
    : `SELECT DISTINCT ON (rid) rid, ${userJsonBuild('matched_users')}::text AS user_json
       FROM matched_users
       ORDER BY rid, part_idx`;

  return `WITH user_mapping(uid, id, title, email) AS (
      VALUES ${mappingValues}
    ),
    text_parts AS (
      SELECT t.__id AS rid, parts.uid, raw_parts.part_idx::integer AS part_idx
      FROM ${fullTableName} AS t
      CROSS JOIN LATERAL regexp_split_to_table(t.${col}, ${quoteLiteral(',')})
        WITH ORDINALITY AS raw_parts(part, part_idx)
      CROSS JOIN LATERAL (SELECT trim(raw_parts.part) AS uid) AS parts
      WHERE t.${col} IS NOT NULL AND parts.uid <> ''
    ),
    matched_users AS (
      SELECT p.rid, p.part_idx, u.id, u.title, u.email
      FROM text_parts AS p
      JOIN user_mapping AS u ON u.uid = p.uid
    ),
    aggregated AS (
      ${aggregationSql}
    )
    UPDATE ${fullTableName} AS t
    SET ${col} = aggregated.user_json
    FROM aggregated
    WHERE t.__id = aggregated.rid`;
};

const buildSelectOptionsFromValuesStatement = (
  params: FieldConversionParams,
  distinctValuesSql: string
): TableSchemaStatementBuilder | null => {
  if (!params.fieldId) {
    return null;
  }

  const colors = SELECT_OPTION_COLORS;
  const previewSql = `
WITH distinct_values AS (
  ${distinctValuesSql}
),
oversized_values AS (
  SELECT name FROM distinct_values
  WHERE char_length(name) > ${SELECT_CHOICE_NAME_MAX_LENGTH}
)
SELECT name FROM distinct_values
WHERE name IS NOT NULL AND name <> ''
  AND NOT EXISTS (SELECT 1 FROM oversized_values);`;

  return {
    scope: 'meta',
    compile: () => sql.raw(previewSql).compile(params.db),
    execute: async ({ dataDb, metaDb }) => {
      const distinctRows = await sql<{ name: string | null }>`
        WITH distinct_values AS (${sql.raw(distinctValuesSql)})
        SELECT DISTINCT name
        FROM distinct_values
        WHERE name IS NOT NULL AND name <> ''
      `.execute(dataDb);

      const distinctNames = distinctRows.rows
        .map((row) => row.name)
        .filter((name): name is string => Boolean(name));
      const oversizedName = distinctNames.find(
        (name) => name.length > SELECT_CHOICE_NAME_MAX_LENGTH
      );
      if (oversizedName) {
        throw new Error(`${selectChoiceNameLengthError}${oversizedName}`);
      }

      const currentRows = await sql<{ options: unknown }>`
        SELECT options
        FROM field
        WHERE id = ${params.fieldId}
        LIMIT 1
      `.execute(metaDb);
      const currentOptions = currentRows.rows[0]?.options;
      const existingNames = new Set(normalizeChoices(currentOptions).map((choice) => choice.name));
      const newNames = distinctNames.filter((name) => !existingNames.has(name));
      if (!newNames.length) {
        return;
      }

      const generatedChoices = newNames.map((name, index) => ({
        id: SelectOptionId.generate()._unsafeUnwrap().toString(),
        name,
        color: colors[index % colors.length],
      }));
      const mergedOptions = buildMergedOptions(currentOptions, generatedChoices);

      await sql`
        UPDATE field
        SET options = ${JSON.stringify(mergedOptions)}
        WHERE id = ${params.fieldId}
      `.execute(metaDb);
    },
  };
};

const buildScalarToLinkMigrationStatements = (
  params: FieldConversionParams,
  oldField: Field,
  newLinkField: LinkField
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> => {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    const dbFieldName = params.dbFieldName;
    const tmpColumnName = `__tmp_link_src_${newLinkField.id().toString()}`;
    const sourceSchema = params.schema ?? 'public';
    const sourceTableName = params.tableName;
    const relationship = newLinkField.relationship().toString();
    const isOneWay = newLinkField.isOneWay();

    const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const dropStatements = yield* oldField.accept(deleteVisitor);
    const createStatements = yield* newLinkField.accept(createVisitor);

    const renameSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} RENAME COLUMN ${quoteIdent(dbFieldName)} TO ${quoteIdent(tmpColumnName)}`;
    let applySqlFragment = '';
    let applyFormatArgs: string[] = [];
    let ensureForeignFkSql = '';
    let ensureForeignOrderSql = '';
    let sourceFkColumnName: string | null = null;
    let sourceOrderColumnName: string | null = null;
    let symmetricDeclareSql = '';
    let buildSymmetricBackfillSql: (metadata: LinkMappingMetadata) => string = () => '';

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      const fkColumnName = yield* newLinkField.foreignKeyNameString();
      const orderColumnName = newLinkField.hasOrderColumn()
        ? yield* newLinkField.orderColumnName()
        : null;
      sourceFkColumnName = fkColumnName;
      sourceOrderColumnName = orderColumnName;
      applySqlFragment = `, picked AS (\
      SELECT DISTINCT ON (source_id) source_id, foreign_id, part_idx\
      FROM mapped\
      ORDER BY source_id, part_idx\
    )\
    UPDATE %I.%I AS t\
    SET %I = p.foreign_id${orderColumnName ? ', %I = p.part_idx' : ''}\
    FROM picked AS p\
    WHERE t.__id = p.source_id`;
      applyFormatArgs = [
        quoteLiteral(sourceSchema),
        quoteLiteral(sourceTableName),
        quoteLiteral(fkColumnName),
        ...(orderColumnName ? [quoteLiteral(orderColumnName)] : []),
      ];
    } else if (relationship === 'oneMany' && !isOneWay) {
      const selfKeyName = yield* newLinkField.selfKeyNameString();
      const foreignKeyName = yield* newLinkField.foreignKeyNameString();
      const fkColumnName = selfKeyName === '__id' ? foreignKeyName : selfKeyName;
      const orderColumnName = `${fkColumnName}_order`;
      ensureForeignFkSql = `EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I text', foreign_schema, foreign_name, ${quoteLiteral(fkColumnName)});`;
      ensureForeignOrderSql = `EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I double precision', foreign_schema, foreign_name, ${quoteLiteral(orderColumnName)});`;
      applySqlFragment = `\
    , picked AS (\
      SELECT DISTINCT ON (foreign_id) foreign_id, source_id, part_idx\
      FROM mapped\
      ORDER BY foreign_id, part_idx, source_id\
    )\
    UPDATE %I.%I AS f\
    SET %I = p.source_id, %I = p.part_idx\
    FROM picked AS p\
    WHERE f.__id = p.foreign_id`;
      applyFormatArgs = [
        'foreign_schema',
        'foreign_name',
        quoteLiteral(fkColumnName),
        quoteLiteral(orderColumnName),
      ];
    } else {
      const fkHostTableName = yield* newLinkField.fkHostTableNameString();
      const junction = splitQualifiedTableName(fkHostTableName);
      const selfKeyName = yield* newLinkField.selfKeyNameString();
      const foreignKeyName = yield* newLinkField.foreignKeyNameString();
      const orderColumnName = newLinkField.hasOrderColumn()
        ? yield* newLinkField.orderColumnName()
        : null;

      if (orderColumnName) {
        applySqlFragment = `\
    INSERT INTO %I.%I (%I, %I, %I)\
    SELECT source_id, foreign_id, part_idx\
    FROM (\
      SELECT DISTINCT ON (source_id, foreign_id) source_id, foreign_id, part_idx\
      FROM mapped\
      ORDER BY source_id, foreign_id, part_idx\
    ) AS deduped`;
        applyFormatArgs = [
          quoteLiteral(junction.schema),
          quoteLiteral(junction.table),
          quoteLiteral(selfKeyName),
          quoteLiteral(foreignKeyName),
          quoteLiteral(orderColumnName),
        ];
      } else {
        applySqlFragment = `\
    INSERT INTO %I.%I (%I, %I)\
    SELECT DISTINCT source_id, foreign_id\
    FROM mapped`;
        applyFormatArgs = [
          quoteLiteral(junction.schema),
          quoteLiteral(junction.table),
          quoteLiteral(selfKeyName),
          quoteLiteral(foreignKeyName),
        ];
      }
    }

    if (!isOneWay && (relationship === 'manyOne' || relationship === 'oneOne')) {
      if (!sourceFkColumnName) {
        return err(
          domainError.unexpected({ message: 'Missing source FK column for link mapping' })
        );
      }

      symmetricDeclareSql = '  symmetric_col text;';

      const sourceQualifiedName = `${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)}`;
      const sourceFkIdent = quoteIdent(sourceFkColumnName);
      const sourceOrderExpr = sourceOrderColumnName
        ? `${quoteIdent(sourceOrderColumnName)} IS NULL DESC, ${quoteIdent(sourceOrderColumnName)} ASC, "__id" ASC`
        : '"__id" ASC';

      if (relationship === 'manyOne') {
        buildSymmetricBackfillSql = (metadata) => `
  symmetric_col := ${sqlNullableLiteral(metadata.symmetricColumnName)};
  IF symmetric_col IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I.%I AS f
       SET %I = src.link_value
       FROM (
         SELECT ${sourceFkIdent} AS foreign_id,
                jsonb_agg(jsonb_build_object(''id'', "__id") ORDER BY ${sourceOrderExpr}) AS link_value
         FROM ${sourceQualifiedName}
         WHERE ${sourceFkIdent} IS NOT NULL
         GROUP BY ${sourceFkIdent}
       ) AS src
       WHERE f."__id" = src.foreign_id',
      foreign_schema,
      foreign_name,
      symmetric_col
    );
  END IF;`;
      } else {
        buildSymmetricBackfillSql = (metadata) => `
  symmetric_col := ${sqlNullableLiteral(metadata.symmetricColumnName)};
  IF symmetric_col IS NOT NULL THEN
    EXECUTE format(
      'UPDATE %I.%I AS f
       SET %I = src.link_value
       FROM (
         SELECT DISTINCT ON (${sourceFkIdent})
                ${sourceFkIdent} AS foreign_id,
                jsonb_build_object(''id'', "__id") AS link_value
         FROM ${sourceQualifiedName}
         WHERE ${sourceFkIdent} IS NOT NULL
         ORDER BY ${sourceFkIdent}, ${sourceOrderExpr}
       ) AS src
       WHERE f."__id" = src.foreign_id',
      foreign_schema,
      foreign_name,
      symmetric_col
    );
  END IF;`;
      }
    } else if (!isOneWay && relationship === 'oneMany') {
      symmetricDeclareSql = '  symmetric_col text;';

      buildSymmetricBackfillSql = (metadata) => `
  symmetric_col := ${sqlNullableLiteral(metadata.symmetricColumnName)};
  IF symmetric_col IS NOT NULL THEN
    EXECUTE format(
      'WITH candidates AS (
         SELECT t.__id AS source_id, p.part_idx, f.__id AS foreign_id
         FROM %I.%I AS t
         CROSS JOIN LATERAL (
           SELECT trim(part) AS token, ordinality AS part_idx
           FROM unnest(string_to_array(t.%I::text, '','')) WITH ORDINALITY AS parts(part, ordinality)
           WHERE trim(part) <> ''''
         ) AS p
         JOIN %I.%I AS f ON f.%I::text = p.token
         WHERE t.%I IS NOT NULL
       ),
       picked AS (
         SELECT DISTINCT ON (foreign_id) foreign_id, source_id, part_idx
         FROM candidates
         ORDER BY foreign_id, part_idx, source_id
       )
       UPDATE %I.%I AS f
       SET %I = jsonb_build_object(''id'', p.source_id)
       FROM picked AS p
       WHERE f.__id = p.foreign_id',
      ${quoteLiteral(sourceSchema)},
      ${quoteLiteral(sourceTableName)},
      ${quoteLiteral(tmpColumnName)},
      foreign_schema,
      foreign_name,
      lookup_col,
      ${quoteLiteral(tmpColumnName)},
      foreign_schema,
      foreign_name,
      symmetric_col
    );
  END IF;`;
    }

    const includeSymmetric = symmetricDeclareSql.length > 0;
    const buildMapFkSql = (metadata: LinkMappingMetadata): string | null => {
      if (!metadata.lookupColumnName || !metadata.foreignTable) {
        return null;
      }

      return `
DO $v2_link_map$
DECLARE
  lookup_col text := ${quoteLiteral(metadata.lookupColumnName)};
${buildTableIdentifierDeclarations(metadata.foreignTable)}
${symmetricDeclareSql}
BEGIN
  IF lookup_col IS NULL OR foreign_schema IS NULL OR foreign_name IS NULL THEN
    RETURN;
  END IF;

  ${ensureForeignFkSql}
  ${ensureForeignOrderSql}

  EXECUTE format(
    'WITH candidates AS (\
      SELECT t.__id AS source_id, p.part_idx, f.__id AS foreign_id\
      FROM %I.%I AS t\
      CROSS JOIN LATERAL (\
        SELECT trim(part) AS token, ordinality AS part_idx\
        FROM unnest(string_to_array(t.%I::text, '','')) WITH ORDINALITY AS parts(part, ordinality)\
        WHERE trim(part) <> ''''\
      ) AS p\
      JOIN %I.%I AS f ON f.%I::text = p.token\
      WHERE t.%I IS NOT NULL\
    ), mapped AS (\
      SELECT source_id, part_idx, foreign_id\
      FROM candidates\
    )${applySqlFragment}',
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    foreign_schema,
    foreign_name,
    lookup_col,
    ${quoteLiteral(tmpColumnName)}${applyFormatArgs.length > 0 ? `, ${applyFormatArgs.join(', ')}` : ''}
  );

${buildSymmetricBackfillSql(metadata)}
END
$v2_link_map$;`;
    };
    const previewMetadata = getPreviewLinkMappingMetadata(params, newLinkField, {
      includeSymmetric,
    });
    const previewMapFkSql =
      buildMapFkSql(previewMetadata) ?? `DO $v2_link_map$ BEGIN RETURN; END $v2_link_map$;`;
    const dropTmpSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} DROP COLUMN IF EXISTS ${quoteIdent(tmpColumnName)}`;

    return ok([
      createCompiledStatementBuilder(params.db, renameSql),
      ...dropStatements,
      ...createStatements,
      createCustomDataStatementBuilder(params.db, previewMapFkSql, async (ctx) =>
        buildMapFkSql(
          await fetchLinkMappingMetadata(ctx, newLinkField, {
            includeSymmetric,
          })
        )
      ),
      createCompiledStatementBuilder(params.db, dropTmpSql),
    ]);
  });
};

const splitQualifiedTableName = (
  qualifiedName: string
): {
  schema: string;
  table: string;
} => {
  if (qualifiedName.includes('.')) {
    const [schema, table] = qualifiedName.split('.', 2);
    return {
      schema: schema || 'public',
      table: table || qualifiedName,
    };
  }
  return {
    schema: 'public',
    table: qualifiedName,
  };
};

/**
 * Convert a dayjs/moment date format string to a PostgreSQL to_char() format string.
 *
 * Mapping:
 *   dayjs      → PostgreSQL
 *   YYYY       → YYYY
 *   MM         → MM
 *   DD         → DD
 *   M          → FMMM  (no leading zero)
 *   D          → FMDD  (no leading zero)
 *   HH         → HH24
 *   hh         → HH12
 *   mm         → MI
 *   A          → AM
 */
const dayjsFormatToPostgres = (dayjsFmt: string): string => {
  // Replace tokens from longest to shortest to avoid partial matches.
  // We use a single-pass replacement via alternation to prevent interference.
  return dayjsFmt.replace(
    /YYYY|MM|DD|HH|hh|mm|[MDA]/g,
    (match) =>
      ({
        YYYY: 'YYYY',
        MM: 'MM',
        DD: 'DD',
        HH: 'HH24',
        hh: 'HH12',
        mm: 'MI',
        M: 'FMMM',
        D: 'FMDD',
        A: 'AM',
      })[match] ?? match
  );
};

/**
 * Build a PostgreSQL to_char() format string from a DateTimeFormatting value object.
 *
 * When time is 'None', only the date portion is used.
 * The timezone from the formatting is used to first shift the timestamptz value
 * via AT TIME ZONE before formatting.
 */
const buildPgDateTimeFormat = (
  formatting: DateTimeFormatting
): { pgFormat: string; timeZone: string } => {
  const dateFormat = formatting.date();
  const timeFormat = formatting.time();
  const timeZone = formatting.timeZone().toString();

  const dayjsFmt = timeFormat === 'None' ? dateFormat : `${dateFormat} ${timeFormat}`;
  return { pgFormat: dayjsFormatToPostgres(dayjsFmt), timeZone };
};

/**
 * Build migration statements for converting a formula field to any target type.
 *
 * This preserves the formula's computed cell values by:
 * 1. Renaming the old column to a temp column
 * 2. Dropping the old field schema (references, etc.)
 * 3. Creating the new field schema
 * 4. Migrating data from temp → new column with appropriate conversion
 * 5. Dropping the temp column
 *
 * The migration SQL is determined by the combination of the formula's
 * cellValueType and the target field type, aligning with v1 behavior where
 * values go through cellValue2String() → convertStringToCellValue().
 */
const buildFormulaMigrationStatements = (
  params: FieldConversionParams,
  oldField: FormulaField,
  newField: Field
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> => {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    const sourceSchema = params.schema ?? 'public';
    const sourceTableName = params.tableName;
    const dbFieldName = params.dbFieldName;
    const tmpColumnName = `__tmp_formula_src_${oldField.id().toString()}`;

    const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forConversion({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const dropStatements = yield* oldField.accept(deleteVisitor);
    const createStatements = yield* newField.accept(createVisitor);

    const renameSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} RENAME COLUMN ${quoteIdent(dbFieldName)} TO ${quoteIdent(tmpColumnName)}`;

    const cellValueTypeResult = oldField.cellValueType();
    const cellValueType = cellValueTypeResult.isOk() ? cellValueTypeResult.value : undefined;
    const newType = newField.type().toString();

    const tbl = `${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)}`;
    const dst = quoteIdent(dbFieldName);
    const tmp = quoteIdent(tmpColumnName);
    const whereNotNull = `WHERE ${tmp} IS NOT NULL`;

    const migrateSql = buildFormulaMigrationSql(
      tbl,
      dst,
      tmp,
      whereNotNull,
      cellValueType,
      newType,
      oldField,
      params
    );

    // Auto-generate select options when converting to singleSelect/multipleSelect
    const optionsStatements: TableSchemaStatementBuilder[] = [];
    if (
      (newType === 'singleSelect' || newType === 'multipleSelect') &&
      params.fieldId &&
      migrateSql
    ) {
      const distinctSql = `SELECT DISTINCT ${tmp}::text AS name FROM ${tbl} WHERE ${tmp} IS NOT NULL AND ${tmp}::text <> ''`;
      const optionsStmt = buildSelectOptionsFromValuesStatement(params, distinctSql);
      if (optionsStmt) {
        optionsStatements.push(optionsStmt);
      }
    }

    const dropTmpSql = `ALTER TABLE ${tbl} DROP COLUMN IF EXISTS ${tmp}`;

    const statements: TableSchemaStatementBuilder[] = [
      createCompiledStatementBuilder(params.db, renameSql),
      ...dropStatements,
      ...createStatements,
      ...optionsStatements,
      ...(migrateSql ? [createCompiledStatementBuilder(params.db, migrateSql)] : []),
      createCompiledStatementBuilder(params.db, dropTmpSql),
    ];

    return ok(statements);
  });
};

type BasicLookupConversionTargetField =
  | SingleLineTextField
  | LongTextField
  | NumberField
  | RatingField
  | CheckboxField
  | DateField
  | SingleSelectField
  | MultipleSelectField;

const isBasicLookupConversionTarget = (field: Field): boolean =>
  [
    'singleLineText',
    'longText',
    'number',
    'rating',
    'checkbox',
    'date',
    'singleSelect',
    'multipleSelect',
  ].includes(field.type().toString());

const buildLookupToBasicFieldMigrationStatements = (
  params: FieldConversionParams,
  oldField: LookupField | ConditionalLookupField,
  newField: BasicLookupConversionTargetField
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> => {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    const sourceSchema = params.schema ?? 'public';
    const sourceTableName = params.tableName;
    const dbFieldName = params.dbFieldName;
    const tmpColumnName = `__tmp_lookup_src_${oldField.id().toString()}`;
    const tbl = `${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)}`;
    const dst = quoteIdent(dbFieldName);
    const tmp = quoteIdent(tmpColumnName);

    const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forConversion({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const dropStatements = yield* oldField.accept(deleteVisitor);
    const createStatements = yield* newField.accept(createVisitor);

    const isMultipleResult = oldField.isMultipleCellValue();
    const sourceIsMultiple = isMultipleResult.isOk() ? isMultipleResult.value.toBoolean() : false;
    const targetIsMultiple = newField.type().toString() === 'multipleSelect';
    const renameSql = `ALTER TABLE ${tbl} RENAME COLUMN ${quoteIdent(dbFieldName)} TO ${tmp}`;
    const arrayValuesExpression = `CASE WHEN ${tmp} IS NOT NULL AND jsonb_typeof(${tmp}::jsonb) = 'array' THEN ${tmp}::jsonb ELSE '[]'::jsonb END`;
    const firstArrayValueExpression = `CASE WHEN jsonb_array_length(${arrayValuesExpression}) > 0 THEN NULLIF(${arrayValuesExpression}->>0, '') ELSE NULL END`;
    const scalarValueExpression = `NULLIF(${tmp}::text, '')`;
    const firstValueExpression = sourceIsMultiple
      ? firstArrayValueExpression
      : scalarValueExpression;
    const textValueExpression = sourceIsMultiple
      ? `NULLIF(replace(btrim(${arrayValuesExpression}::text, '[]'), '"', ''), '')`
      : scalarValueExpression;
    const numericValueExpression = `CASE WHEN (${firstValueExpression}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${firstValueExpression})::double precision ELSE NULL END`;
    const targetType = newField.type().toString();
    const valueExpression = (() => {
      switch (targetType) {
        case 'singleLineText':
        case 'longText':
          return textValueExpression;
        case 'number':
          return numericValueExpression;
        case 'rating': {
          const max = (newField as RatingField).ratingMax().toNumber();
          return `CASE WHEN (${firstValueExpression}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN GREATEST(0, LEAST(FLOOR((${firstValueExpression})::double precision), ${max})) ELSE NULL END`;
        }
        case 'checkbox':
          return `CASE WHEN lower((${firstValueExpression})::text) IN ('true', 't', '1', 'yes', 'y') THEN TRUE WHEN lower((${firstValueExpression})::text) IN ('false', 'f', '0', 'no', 'n') THEN FALSE WHEN (${firstValueExpression}) IS NOT NULL AND (${firstValueExpression}) <> '' THEN TRUE ELSE NULL END`;
        case 'date':
          return `CASE WHEN (${firstValueExpression}) ~ ${quoteLiteral(ISO_DATE_OR_DATETIME_SQL_REGEX)} THEN (${firstValueExpression})::timestamptz ELSE NULL END`;
        case 'singleSelect':
          return firstValueExpression;
        case 'multipleSelect':
          return targetIsMultiple && sourceIsMultiple
            ? arrayValuesExpression
            : `CASE WHEN ${scalarValueExpression} IS NOT NULL THEN jsonb_build_array(${tmp}::text) ELSE NULL END`;
        default:
          return 'NULL';
      }
    })();
    const distinctValuesSql = sourceIsMultiple
      ? `SELECT DISTINCT value AS name FROM ${tbl} CROSS JOIN LATERAL jsonb_array_elements_text(${arrayValuesExpression}) AS value WHERE value <> ''`
      : `SELECT DISTINCT ${tmp}::text AS name FROM ${tbl} WHERE ${tmp} IS NOT NULL AND ${tmp}::text <> ''`;
    const optionsStatement =
      targetType === 'singleSelect' || targetType === 'multipleSelect'
        ? buildSelectOptionsFromValuesStatement(params, distinctValuesSql)
        : null;
    const migrateSql = `UPDATE ${tbl} SET ${dst} = ${valueExpression} WHERE ${tmp} IS NOT NULL`;
    const dropTmpSql = `ALTER TABLE ${tbl} DROP COLUMN IF EXISTS ${tmp}`;

    return ok([
      createCompiledStatementBuilder(params.db, renameSql),
      ...dropStatements,
      ...createStatements,
      ...(optionsStatement ? [optionsStatement] : []),
      createCompiledStatementBuilder(params.db, migrateSql),
      createCompiledStatementBuilder(params.db, dropTmpSql),
    ]);
  });
};

/**
 * Build the UPDATE SQL for migrating formula data to a new column type.
 * Returns null when conversion should produce NULL values (incompatible types).
 */
function buildFormulaMigrationSql(
  tbl: string,
  dst: string,
  tmp: string,
  whereNotNull: string,
  cellValueType: CellValueType | undefined,
  newType: string,
  oldField: FormulaField,
  _params: FieldConversionParams
): string | null {
  const isDateTime = cellValueType?.equals(CellValueType.dateTime());
  const isNumber = cellValueType?.equals(CellValueType.number());
  const isString = cellValueType?.equals(CellValueType.string());
  const isBoolean = cellValueType?.equals(CellValueType.boolean());

  // --- Target: text (singleLineText or longText) ---
  if (newType === 'singleLineText' || newType === 'longText') {
    if (isDateTime) {
      const formatting = oldField.formatting();
      const dtFormatting =
        formatting instanceof DateTimeFormatting ? formatting : DateTimeFormatting.default();
      const { pgFormat, timeZone } = buildPgDateTimeFormat(dtFormatting);
      const tz = timeZone === 'utc' ? 'UTC' : timeZone;
      return `UPDATE ${tbl} SET ${dst} = to_char(${tmp} AT TIME ZONE ${quoteLiteral(tz)}, ${quoteLiteral(pgFormat)}) ${whereNotNull}`;
    }
    // number, boolean, string: cast to text
    return `UPDATE ${tbl} SET ${dst} = ${tmp}::text ${whereNotNull}`;
  }

  // --- Target: number ---
  if (newType === 'number') {
    if (isNumber) {
      // double precision → double precision: direct copy
      return `UPDATE ${tbl} SET ${dst} = ${tmp} ${whereNotNull}`;
    }
    if (isString) {
      // Try to parse string as number; non-numeric → NULL
      return `UPDATE ${tbl} SET ${dst} = CASE WHEN ${tmp} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${tmp}::double precision ELSE NULL END ${whereNotNull}`;
    }
    // dateTime, boolean → number: incompatible (v1 returns null)
    return null;
  }

  // --- Target: rating ---
  if (newType === 'rating') {
    if (isNumber) {
      // Clamp number to valid rating range [1, max]
      return `UPDATE ${tbl} SET ${dst} = CASE WHEN ${tmp} >= 1 THEN LEAST(${tmp}, ${dst}) ELSE NULL END ${whereNotNull}`;
    }
    return null;
  }

  // --- Target: date ---
  if (newType === 'date') {
    if (isDateTime) {
      // timestamptz → timestamptz: direct copy
      return `UPDATE ${tbl} SET ${dst} = ${tmp} ${whereNotNull}`;
    }
    if (isString) {
      // Try to parse string as timestamp
      return `UPDATE ${tbl} SET ${dst} = CASE WHEN ${tmp} ~ ${quoteLiteral(ISO_DATE_OR_DATETIME_SQL_REGEX)} THEN ${tmp}::timestamptz ELSE NULL END ${whereNotNull}`;
    }
    // number, boolean → date: incompatible
    return null;
  }

  // --- Target: checkbox ---
  if (newType === 'checkbox') {
    if (isBoolean) {
      // boolean → boolean: direct copy
      return `UPDATE ${tbl} SET ${dst} = ${tmp} ${whereNotNull}`;
    }
    // Any non-null value → true (v1: any non-empty cellValue2String → true)
    return `UPDATE ${tbl} SET ${dst} = TRUE ${whereNotNull}`;
  }

  // --- Target: singleSelect ---
  if (newType === 'singleSelect') {
    if (isDateTime) {
      const formatting = oldField.formatting();
      const dtFormatting =
        formatting instanceof DateTimeFormatting ? formatting : DateTimeFormatting.default();
      const { pgFormat, timeZone } = buildPgDateTimeFormat(dtFormatting);
      const tz = timeZone === 'utc' ? 'UTC' : timeZone;
      return `UPDATE ${tbl} SET ${dst} = to_char(${tmp} AT TIME ZONE ${quoteLiteral(tz)}, ${quoteLiteral(pgFormat)}) ${whereNotNull}`;
    }
    return `UPDATE ${tbl} SET ${dst} = ${tmp}::text ${whereNotNull}`;
  }

  // --- Target: multipleSelect ---
  if (newType === 'multipleSelect') {
    if (isDateTime) {
      const formatting = oldField.formatting();
      const dtFormatting =
        formatting instanceof DateTimeFormatting ? formatting : DateTimeFormatting.default();
      const { pgFormat, timeZone } = buildPgDateTimeFormat(dtFormatting);
      const tz = timeZone === 'utc' ? 'UTC' : timeZone;
      return `UPDATE ${tbl} SET ${dst} = jsonb_build_array(to_char(${tmp} AT TIME ZONE ${quoteLiteral(tz)}, ${quoteLiteral(pgFormat)})) ${whereNotNull}`;
    }
    return `UPDATE ${tbl} SET ${dst} = jsonb_build_array(${tmp}::text) ${whereNotNull}`;
  }

  // --- Unsupported target types (attachment, user, button, link, etc.) ---
  // Return null → column stays NULL after conversion (data not transferable)
  return null;
}

const buildLinkToTextMigrationStatements = (
  params: FieldConversionParams,
  oldField: LinkField,
  newField: Field
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> => {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    const sourceSchema = params.schema ?? 'public';
    const sourceTableName = params.tableName;
    const dbFieldName = params.dbFieldName;
    const tmpColumnName = `__tmp_link_src_${oldField.id().toString()}`;

    const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forConversion({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const dropStatements = yield* oldField.accept(deleteVisitor);
    const createStatements = yield* newField.accept(createVisitor);

    const renameSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} RENAME COLUMN ${quoteIdent(dbFieldName)} TO ${quoteIdent(tmpColumnName)}`;
    const buildMapTextSql = (metadata: LinkMappingMetadata): string | null => {
      if (!metadata.lookupColumnName || !metadata.foreignTable) {
        return null;
      }

      return `
DO $v2_link_to_text$
DECLARE
  lookup_col text := ${quoteLiteral(metadata.lookupColumnName)};
${buildTableIdentifierDeclarations(metadata.foreignTable)}
BEGIN
  IF lookup_col IS NULL OR foreign_schema IS NULL OR foreign_name IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'WITH parsed AS (\
      SELECT t.__id AS source_id, 1::integer AS part_idx, NULLIF(trim((t.%I::jsonb ->> ''id'')::text), '''') AS link_id\
      FROM %I.%I AS t\
      WHERE t.%I IS NOT NULL AND jsonb_typeof(t.%I::jsonb) = ''object''\
      UNION ALL\
      SELECT t.__id AS source_id, arr.ordinality::integer AS part_idx, NULLIF(trim((arr.elem ->> ''id'')::text), '''') AS link_id\
      FROM %I.%I AS t\
      CROSS JOIN LATERAL jsonb_array_elements(t.%I::jsonb) WITH ORDINALITY AS arr(elem, ordinality)\
      WHERE t.%I IS NOT NULL AND jsonb_typeof(t.%I::jsonb) = ''array''\
    ), mapped AS (\
      SELECT p.source_id, p.part_idx, f.%I::text AS title\
      FROM parsed AS p\
      JOIN %I.%I AS f ON f.__id = p.link_id\
      WHERE p.link_id IS NOT NULL\
    ), reduced AS (\
      SELECT source_id, string_agg(title, '', '' ORDER BY part_idx) AS text_value\
      FROM mapped\
      GROUP BY source_id\
    )\
    UPDATE %I.%I AS t\
    SET %I = r.text_value\
    FROM reduced AS r\
    WHERE t.__id = r.source_id',
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    lookup_col,
    foreign_schema,
    foreign_name,
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(dbFieldName)}
  );
END
$v2_link_to_text$;`;
    };
    const previewMapTextSql =
      buildMapTextSql(getPreviewLinkMappingMetadata(params, oldField)) ??
      `DO $v2_link_to_text$ BEGIN RETURN; END $v2_link_to_text$;`;
    const dropTmpSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} DROP COLUMN IF EXISTS ${quoteIdent(tmpColumnName)}`;

    return ok([
      createCompiledStatementBuilder(params.db, renameSql),
      ...dropStatements,
      ...createStatements,
      createCustomDataStatementBuilder(params.db, previewMapTextSql, async (ctx) =>
        buildMapTextSql(await fetchLinkMappingMetadata(ctx, oldField))
      ),
      createCompiledStatementBuilder(params.db, dropTmpSql),
    ]);
  });
};

const buildLinkToSelectMigrationStatements = (
  params: FieldConversionParams,
  oldField: LinkField,
  newField: SingleSelectField | MultipleSelectField
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> => {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    const sourceSchema = params.schema ?? 'public';
    const sourceTableName = params.tableName;
    const dbFieldName = params.dbFieldName;
    const tmpColumnName = `__tmp_link_src_${oldField.id().toString()}`;
    const isMultipleSelect = newField.type().toString() === 'multipleSelect';

    const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forConversion({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const dropStatements = yield* oldField.accept(deleteVisitor);
    const createStatements = yield* newField.accept(createVisitor);

    const renameSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} RENAME COLUMN ${quoteIdent(dbFieldName)} TO ${quoteIdent(tmpColumnName)}`;
    const buildMapSelectSql = (metadata: LinkMappingMetadata): string | null => {
      if (!metadata.lookupColumnName || !metadata.foreignTable) {
        return null;
      }

      return `
DO $v2_link_to_select$
DECLARE
  lookup_col text := ${quoteLiteral(metadata.lookupColumnName)};
${buildTableIdentifierDeclarations(metadata.foreignTable)}
BEGIN
  IF lookup_col IS NULL OR foreign_schema IS NULL OR foreign_name IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'WITH parsed AS (\
      SELECT t.__id AS source_id, 1::integer AS part_idx, NULLIF(trim((t.%I::jsonb ->> ''id'')::text), '''') AS link_id\
      FROM %I.%I AS t\
      WHERE t.%I IS NOT NULL AND jsonb_typeof(t.%I::jsonb) = ''object''\
      UNION ALL\
      SELECT t.__id AS source_id, arr.ordinality::integer AS part_idx, NULLIF(trim((arr.elem ->> ''id'')::text), '''') AS link_id\
      FROM %I.%I AS t\
      CROSS JOIN LATERAL jsonb_array_elements(t.%I::jsonb) WITH ORDINALITY AS arr(elem, ordinality)\
      WHERE t.%I IS NOT NULL AND jsonb_typeof(t.%I::jsonb) = ''array''\
    ), mapped AS (\
      SELECT p.source_id, p.part_idx, f.%I::text AS title\
      FROM parsed AS p\
      JOIN %I.%I AS f ON f.__id = p.link_id\
      WHERE p.link_id IS NOT NULL\
    ), reduced AS (\
      SELECT source_id, ${isMultipleSelect ? 'jsonb_agg(title ORDER BY part_idx) AS cell_value' : "string_agg(title, '', '' ORDER BY part_idx) AS cell_value"}\
      FROM mapped\
      GROUP BY source_id\
    )\
    UPDATE %I.%I AS t\
    SET %I = r.cell_value\
    FROM reduced AS r\
    WHERE t.__id = r.source_id',
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    lookup_col,
    foreign_schema,
    foreign_name,
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(dbFieldName)}
  );
END
$v2_link_to_select$;`;
    };
    const previewMapSelectSql =
      buildMapSelectSql(getPreviewLinkMappingMetadata(params, oldField)) ??
      `DO $v2_link_to_select$ BEGIN RETURN; END $v2_link_to_select$;`;

    const singleSelectOptions = buildSelectOptionsFromValuesStatement(
      params,
      `SELECT DISTINCT ${quoteIdent(dbFieldName)} AS name
       FROM ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)}
       WHERE ${quoteIdent(dbFieldName)} IS NOT NULL
         AND ${quoteIdent(dbFieldName)} <> ''`
    );

    const multipleSelectOptions = buildSelectOptionsFromValuesStatement(
      params,
      `SELECT DISTINCT trim(value) AS name
       FROM ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} AS t
       CROSS JOIN LATERAL jsonb_array_elements_text(t.${quoteIdent(dbFieldName)}) AS value
       WHERE t.${quoteIdent(dbFieldName)} IS NOT NULL
         AND jsonb_typeof(t.${quoteIdent(dbFieldName)}) = 'array'
         AND trim(value) <> ''`
    );

    const dropTmpSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} DROP COLUMN IF EXISTS ${quoteIdent(tmpColumnName)}`;

    return ok([
      createCompiledStatementBuilder(params.db, renameSql),
      ...dropStatements,
      ...createStatements,
      createCustomDataStatementBuilder(params.db, previewMapSelectSql, async (ctx) =>
        buildMapSelectSql(await fetchLinkMappingMetadata(ctx, oldField))
      ),
      ...(isMultipleSelect
        ? multipleSelectOptions
          ? [multipleSelectOptions]
          : []
        : singleSelectOptions
          ? [singleSelectOptions]
          : []),
      createCompiledStatementBuilder(params.db, dropTmpSql),
    ]);
  });
};

const buildLinkToLinkForeignTableMigrationStatements = (
  params: FieldConversionParams,
  oldLinkField: LinkField,
  newLinkField: LinkField
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> => {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    const sourceSchema = params.schema ?? 'public';
    const sourceTableName = params.tableName;
    const dbFieldName = params.dbFieldName;
    const tmpColumnName = `__tmp_link_src_${newLinkField.id().toString()}`;

    const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
      db: params.db,
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
    });

    const dropStatements = yield* oldLinkField.accept(deleteVisitor);
    const createStatements = yield* newLinkField.accept(createVisitor);

    const renameSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} RENAME COLUMN ${quoteIdent(dbFieldName)} TO ${quoteIdent(tmpColumnName)}`;

    const relationship = newLinkField.relationship().toString();
    const isOneWay = newLinkField.isOneWay();

    let applySqlFragment = '';
    let applyFormatArgs: string[] = [];
    let ensureForeignFkSql = '';
    let ensureForeignOrderSql = '';

    if (relationship === 'manyOne' || relationship === 'oneOne') {
      const fkColumnName = yield* newLinkField.foreignKeyNameString();
      applySqlFragment = `, picked AS (\
      SELECT DISTINCT ON (source_id) source_id, foreign_id\
      FROM mapped\
      ORDER BY source_id, part_idx\
    )\
    UPDATE %I.%I AS t\
    SET %I = p.foreign_id\
    FROM picked AS p\
    WHERE t.__id = p.source_id`;
      applyFormatArgs = [
        quoteLiteral(sourceSchema),
        quoteLiteral(sourceTableName),
        quoteLiteral(fkColumnName),
      ];
    } else if (relationship === 'oneMany' && !isOneWay) {
      const selfKeyName = yield* newLinkField.selfKeyNameString();
      const foreignKeyName = yield* newLinkField.foreignKeyNameString();
      const fkColumnName = selfKeyName === '__id' ? foreignKeyName : selfKeyName;
      const orderColumnName = `${fkColumnName}_order`;
      ensureForeignFkSql = `EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I text', foreign_schema, foreign_name, ${quoteLiteral(fkColumnName)});`;
      ensureForeignOrderSql = `EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS %I double precision', foreign_schema, foreign_name, ${quoteLiteral(orderColumnName)});`;
      if (orderColumnName) {
        applySqlFragment = `\
    , picked AS (\
      SELECT DISTINCT ON (foreign_id) foreign_id, source_id, part_idx\
      FROM mapped\
      ORDER BY foreign_id, part_idx, source_id\
    )\
    UPDATE %I.%I AS f\
    SET %I = p.source_id, %I = p.part_idx\
    FROM picked AS p\
    WHERE f.__id = p.foreign_id`;
        applyFormatArgs = [
          'foreign_schema',
          'foreign_name',
          quoteLiteral(fkColumnName),
          quoteLiteral(orderColumnName),
        ];
      } else {
        applySqlFragment = `\
    , picked AS (\
      SELECT DISTINCT ON (foreign_id) foreign_id, source_id\
      FROM mapped\
      ORDER BY foreign_id, part_idx, source_id\
    )\
    UPDATE %I.%I AS f\
    SET %I = p.source_id\
    FROM picked AS p\
    WHERE f.__id = p.foreign_id`;
        applyFormatArgs = ['foreign_schema', 'foreign_name', quoteLiteral(fkColumnName)];
      }
    } else {
      const fkHostTableName = yield* newLinkField.fkHostTableNameString();
      const junction = splitQualifiedTableName(fkHostTableName);
      const selfKeyName = yield* newLinkField.selfKeyNameString();
      const foreignKeyName = yield* newLinkField.foreignKeyNameString();
      const orderColumnName = newLinkField.hasOrderColumn()
        ? yield* newLinkField.orderColumnName()
        : null;

      if (orderColumnName) {
        applySqlFragment = `\
    INSERT INTO %I.%I (%I, %I, %I)\
    SELECT source_id, foreign_id, part_idx\
    FROM (\
      SELECT DISTINCT ON (source_id, foreign_id) source_id, foreign_id, part_idx\
      FROM mapped\
      ORDER BY source_id, foreign_id, part_idx\
    ) AS deduped`;
        applyFormatArgs = [
          quoteLiteral(junction.schema),
          quoteLiteral(junction.table),
          quoteLiteral(selfKeyName),
          quoteLiteral(foreignKeyName),
          quoteLiteral(orderColumnName),
        ];
      } else {
        applySqlFragment = `\
    INSERT INTO %I.%I (%I, %I)\
    SELECT DISTINCT source_id, foreign_id\
    FROM mapped`;
        applyFormatArgs = [
          quoteLiteral(junction.schema),
          quoteLiteral(junction.table),
          quoteLiteral(selfKeyName),
          quoteLiteral(foreignKeyName),
        ];
      }
    }

    const buildMapSql = (metadata: LinkMappingMetadata): string | null => {
      if (!metadata.lookupColumnName || !metadata.foreignTable) {
        return null;
      }

      return `
DO $v2_link_remap$
DECLARE
  lookup_col text := ${quoteLiteral(metadata.lookupColumnName)};
${buildTableIdentifierDeclarations(metadata.foreignTable)}
BEGIN
  IF lookup_col IS NULL OR foreign_schema IS NULL OR foreign_name IS NULL THEN
    RETURN;
  END IF;

  ${ensureForeignFkSql}
  ${ensureForeignOrderSql}

  EXECUTE format(
    'WITH parsed AS (\
      SELECT t.__id AS source_id, 1::integer AS part_idx, NULLIF(trim((t.%I::jsonb ->> ''title'')::text), '''') AS title\
      FROM %I.%I AS t\
      WHERE t.%I IS NOT NULL AND jsonb_typeof(t.%I::jsonb) = ''object''\
      UNION ALL\
      SELECT t.__id AS source_id, arr.ordinality::integer AS part_idx, NULLIF(trim((arr.elem ->> ''title'')::text), '''') AS title\
      FROM %I.%I AS t\
      CROSS JOIN LATERAL jsonb_array_elements(t.%I::jsonb) WITH ORDINALITY AS arr(elem, ordinality)\
      WHERE t.%I IS NOT NULL AND jsonb_typeof(t.%I::jsonb) = ''array''\
    ), mapped AS (\
      SELECT DISTINCT ON (p.source_id, p.part_idx) p.source_id, p.part_idx, f.__id AS foreign_id\
      FROM parsed AS p\
      JOIN %I.%I AS f ON f.%I::text = p.title\
      WHERE p.title IS NOT NULL\
      ORDER BY p.source_id, p.part_idx, f.__id\
    )${applySqlFragment}',
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(sourceSchema)},
    ${quoteLiteral(sourceTableName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    ${quoteLiteral(tmpColumnName)},
    foreign_schema,
    foreign_name,
    lookup_col${applyFormatArgs.length > 0 ? `, ${applyFormatArgs.join(', ')}` : ''}
  );
END
$v2_link_remap$;`;
    };
    const previewMapSql =
      buildMapSql(getPreviewLinkMappingMetadata(params, newLinkField)) ??
      `DO $v2_link_remap$ BEGIN RETURN; END $v2_link_remap$;`;

    const dropTmpSql = `ALTER TABLE ${quoteIdent(sourceSchema)}.${quoteIdent(sourceTableName)} DROP COLUMN IF EXISTS ${quoteIdent(tmpColumnName)}`;

    return ok([
      createCompiledStatementBuilder(params.db, renameSql),
      ...dropStatements,
      ...createStatements,
      createCustomDataStatementBuilder(params.db, previewMapSql, async (ctx) =>
        buildMapSql(await fetchLinkMappingMetadata(ctx, newLinkField))
      ),
      createCompiledStatementBuilder(params.db, dropTmpSql),
    ]);
  });
};

/** Color palette for auto-generated select options */
const SELECT_OPTION_COLORS = [
  'grayBright',
  'yellowBright',
  'orangeBright',
  'tealBright',
  'redBright',
  'pinkBright',
  'purpleBright',
  'cyanBright',
  'blueBright',
  'greenBright',
] as const;

/**
 * Base visitor for converting field data from one type to another.
 *
 * Each source field type has its own visitor that defines how to convert
 * its data to various target types. The visitor is called with the OLD field
 * (source) and generates SQL statements based on the NEW field (target) type.
 *
 * Database type mapping:
 * - text: SingleLineText, LongText, SingleSelect, Link
 * - double precision: Number, Rating, AutoNumber
 * - boolean: Checkbox
 * - timestamptz: Date
 * - jsonb: MultipleSelect, Attachment, User, Button
 *
 * Conversion strategy:
 * 1. Convert data values (UPDATE statements)
 * 2. Alter column type (ALTER TABLE)
 */
export abstract class BaseFieldConversionVisitor extends AbstractFieldVisitor<
  ReadonlyArray<TableSchemaStatementBuilder>
> {
  constructor(protected readonly params: FieldConversionParams) {
    super();
  }

  /**
   * Get the qualified table name for SQL statements.
   */
  protected get fullTableName(): string {
    const { schema, tableName } = this.params;
    return schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;
  }

  /**
   * Get the column reference.
   */
  protected get columnRef(): string {
    return `"${this.params.dbFieldName}"`;
  }

  /**
   * Create a statement builder from a compiled query.
   */
  protected toBuilder(query: CompiledQuery): TableSchemaStatementBuilder {
    return { scope: 'data', compile: () => query };
  }

  /**
   * Generate an ALTER COLUMN TYPE statement with simple cast.
   */
  protected alterColumnType(newType: string): TableSchemaStatementBuilder {
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    return {
      scope: 'data',
      compile: () =>
        sql`ALTER TABLE ${sql.raw(fullTableName)} ALTER COLUMN "${sql.raw(dbFieldName)}" TYPE ${sql.raw(newType)} USING "${sql.raw(dbFieldName)}"::${sql.raw(newType)}`.compile(
          db
        ),
    };
  }

  /**
   * Generate an ALTER COLUMN TYPE statement with custom USING expression.
   * This allows data transformation and type change in a single statement.
   */
  protected alterColumnTypeUsing(newType: string, usingExpr: string): TableSchemaStatementBuilder {
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    return {
      scope: 'data',
      compile: () =>
        sql`ALTER TABLE ${sql.raw(fullTableName)} ALTER COLUMN "${sql.raw(dbFieldName)}" TYPE ${sql.raw(newType)} USING ${sql.raw(usingExpr)}`.compile(
          db
        ),
    };
  }

  /**
   * Generate an ALTER COLUMN TYPE statement that sets all values to NULL.
   * Used when conversion is not possible - combines nullify + type change in one statement.
   */
  protected alterColumnTypeToNull(newType: string): TableSchemaStatementBuilder {
    return this.alterColumnTypeUsing(newType, 'NULL');
  }

  /**
   * Generate SQL to auto-populate select options from distinct column values.
   *
   * This queries distinct non-null values from the source column and merges them
   * into the field's options.choices array, generating IDs and colors for new options.
   *
   * SQL approach:
   * 1. Query distinct values from the data column (cast to text for non-text columns)
   * 2. Generate choice objects with random IDs and colors
   * 3. Merge with existing choices (if any)
   * 4. Update the field table's options column
   */
  protected generateSelectOptionsFromValues(): TableSchemaStatementBuilder | null {
    const { fieldId, dbFieldName } = this.params;
    if (!fieldId) {
      return null;
    }

    const fullTableName = this.fullTableName;
    return buildSelectOptionsFromValuesStatement(
      this.params,
      `SELECT DISTINCT ${quoteIdent(dbFieldName)}::text AS name
       FROM ${fullTableName}
       WHERE ${quoteIdent(dbFieldName)} IS NOT NULL
         AND ${quoteIdent(dbFieldName)}::text <> ''`
    );
  }

  /**
   * These field types require schema recreation and should never reach the conversion visitor.
   * If called, it indicates a bug in the conversion flow.
   */
  protected schemaRecreationRequired(): Result<
    ReadonlyArray<TableSchemaStatementBuilder>,
    DomainError
  > {
    return err(
      domainError.invariant({
        message:
          'This field type requires schema recreation. The conversion should be handled by generateFieldConversionStatements.',
      })
    );
  }

  // Default implementations - subclasses override for supported conversions
  // These methods should not be called because generateFieldConversionStatements
  // handles them via schema recreation (drop + create)

  visitFormulaField(
    _field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitRollupField(
    _field: RollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitLookupField(
    _field: LookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitCreatedTimeField(
    _field: CreatedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitCreatedByField(
    _field: CreatedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitLastModifiedByField(
    _field: LastModifiedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitAutoNumberField(
    _field: AutoNumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }

  visitLinkField(
    _field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.schemaRecreationRequired();
  }
}

/**
 * Factory that creates a conversion visitor based on the source field type.
 * The visitor then generates SQL statements based on the target field type.
 */
export class FieldTypeConversionVisitorFactory extends AbstractFieldVisitor<BaseFieldConversionVisitor> {
  constructor(private readonly params: FieldConversionParams) {
    super();
  }

  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new TextFieldConversionVisitor(this.params));
  }

  visitLongTextField(_field: LongTextField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new LongTextFieldConversionVisitor(this.params));
  }

  visitNumberField(_field: NumberField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new NumberFieldConversionVisitor(this.params, _field));
  }

  visitRatingField(_field: RatingField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new RatingFieldConversionVisitor(this.params));
  }

  visitCheckboxField(_field: CheckboxField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new CheckboxFieldConversionVisitor(this.params));
  }

  visitDateField(_field: DateField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new DateFieldConversionVisitor(this.params));
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new SelectFieldConversionVisitor(this.params));
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new MultipleSelectFieldConversionVisitor(this.params));
  }

  visitAttachmentField(_field: AttachmentField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new JsonFieldConversionVisitor(this.params));
  }

  visitUserField(_field: UserField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new UserFieldConversionVisitor(this.params));
  }

  visitButtonField(_field: ButtonField): Result<BaseFieldConversionVisitor, DomainError> {
    return ok(new JsonFieldConversionVisitor(this.params));
  }

  // Computed/system fields - conversion FROM them is not typically supported
  visitFormulaField(_field: FormulaField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from formula field' }));
  }

  visitRollupField(_field: RollupField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from rollup field' }));
  }

  visitLookupField(_field: LookupField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from lookup field' }));
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from conditional rollup field' }));
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from conditional lookup field' }));
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from created time field' }));
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from last modified time field' }));
  }

  visitCreatedByField(_field: CreatedByField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from created by field' }));
  }

  visitLastModifiedByField(
    _field: LastModifiedByField
  ): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from last modified by field' }));
  }

  visitAutoNumberField(_field: AutoNumberField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from auto number field' }));
  }

  visitLinkField(_field: LinkField): Result<BaseFieldConversionVisitor, DomainError> {
    return err(domainError.validation({ message: 'Cannot convert from link field' }));
  }
}

/**
 * Conversion visitor for text-based fields (SingleLineText, LongText).
 * Source DB type: text
 */
class TextFieldConversionVisitor extends BaseFieldConversionVisitor {
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Text: no conversion needed
    return ok([]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Text: no conversion needed
    return ok([]);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Number: parse numeric strings, NULL for invalid
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'double precision',
        `CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${col}::double precision ELSE NULL END`
      ),
    ]);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Rating: parse as number, floor to integer, clamp to [0, max]
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const max = field.ratingMax().toNumber();
    return ok([
      this.alterColumnTypeUsing(
        'double precision',
        `CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN GREATEST(0, LEAST(FLOOR(${col}::double precision), ${max})) ELSE NULL END`
      ),
    ]);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Checkbox: any non-empty, non-null text = true (matches V1 behavior)
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'boolean',
        `CASE WHEN ${col} IS NOT NULL AND ${col} <> '' THEN TRUE ELSE NULL END`
      ),
    ]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Date: parse ISO date strings
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'timestamptz',
        `CASE WHEN ${col} ~ ${quoteLiteral(ISO_DATE_OR_DATETIME_SQL_REGEX)} THEN ${col}::timestamptz ELSE NULL END`
      ),
    ]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → SingleSelect: keep as text (same DB type)
    // Auto-generate options from distinct values in the column
    const statements: TableSchemaStatementBuilder[] = [];
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }
    return ok(statements);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → MultipleSelect: CSV-aware split into array (V1 parity)
    // Respects double-quoted fields so commas inside "..." are preserved.
    // Auto-generate options from distinct split values
    const { db, dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const fullTableName = this.fullTableName;
    const statements: TableSchemaStatementBuilder[] = [];
    // CSV-aware regex: matches either "quoted content" or unquoted field
    // E-string \\n/\\r → PG \n/\r → literal newline/CR in regex
    const csvFieldRegex = `E' *(?:"([^"]*)"|([^,\\n\\r]+))'`;

    const optionsStatement = buildSelectOptionsFromValuesStatement(
      this.params,
      `SELECT DISTINCT COALESCE(trim(m[1]), trim(m[2])) AS name
       FROM ${fullTableName}, regexp_matches(${col}, ${csvFieldRegex}, 'g') AS m
       WHERE ${col} IS NOT NULL
         AND COALESCE(trim(m[1]), trim(m[2])) <> ''`
    );
    if (optionsStatement) {
      statements.push(optionsStatement);
    }

    // CSV-aware split: aggregate quoted/unquoted fields into jsonb array
    statements.push({
      scope: 'data',
      compile: () =>
        sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.raw(col)} = (
          SELECT jsonb_agg(COALESCE(trim(m[1]), trim(m[2])))::text
          FROM regexp_matches(${sql.raw(col)}, ${sql.raw(csvFieldRegex)}, 'g') AS m
          WHERE COALESCE(trim(m[1]), trim(m[2])) <> ''
        ) WHERE ${sql.raw(col)} IS NOT NULL`.compile(db),
    });

    statements.push(this.alterColumnTypeUsing('jsonb', `${col}::jsonb`));

    return ok(statements);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Attachment: clear data (not compatible)
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitUserField(
    field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text -> User: resolve text parts through the meta DB at execution time, then write only
    // the resolved snapshots back to the data DB. This keeps data SQL free of meta-table joins
    // for BYODB while preserving the old "unmatched text becomes NULL" conversion behavior.
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    const col = `"${dbFieldName}"`;
    const isMultiple = field.multiplicity().toBoolean();
    const cleanupSql = `UPDATE ${fullTableName} SET ${col} = NULL WHERE ${col} IS NOT NULL AND left(${col}, 1) NOT IN ('{', '[')`;
    const previewSql =
      buildTextToUserTransformSql(fullTableName, col, isMultiple, [
        {
          lookupValue: '__preview_user__',
          id: '__preview_user__',
          title: '__preview_user__',
          email: null,
        },
      ]) ?? cleanupSql;

    return ok([
      {
        scope: 'data',
        compile: () => sql.raw(previewSql).compile(db),
        execute: async (ctx) => {
          const mappings = await fetchTextUserMappings(ctx, fullTableName, col);
          const transformSql = buildTextToUserTransformSql(
            fullTableName,
            col,
            isMultiple,
            mappings
          );
          if (transformSql) {
            await sql.raw(transformSql).execute(ctx.dataDb);
          }
          await sql.raw(cleanupSql).execute(ctx.dataDb);
        },
      },
      {
        scope: 'data',
        compile: () =>
          sql`ALTER TABLE ${sql.raw(fullTableName)} ALTER COLUMN ${sql.raw(col)} TYPE jsonb USING ${sql.raw(col)}::jsonb`.compile(
            db
          ),
      },
    ]);
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Text → Button: clear data (not compatible)
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }
}

/**
 * Conversion visitor for long text fields.
 * Source DB type: text (same as SingleLineText, but content may contain newlines)
 *
 * LongText values can contain newlines which are incompatible with single-line
 * targets. This visitor replaces newlines with spaces before delegating to
 * the parent TextFieldConversionVisitor logic.
 */
class LongTextFieldConversionVisitor extends TextFieldConversionVisitor {
  /**
   * Generate an UPDATE statement that replaces newlines with spaces.
   */
  private replaceNewlines(): TableSchemaStatementBuilder {
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    return {
      scope: 'data',
      compile: () =>
        sql`UPDATE ${sql.raw(fullTableName)} SET "${sql.raw(dbFieldName)}" = REPLACE(REPLACE("${sql.raw(dbFieldName)}", E'\r\n', ' '), E'\n', ' ') WHERE "${sql.raw(dbFieldName)}" IS NOT NULL AND "${sql.raw(dbFieldName)}" LIKE '%' || E'\n' || '%'`.compile(
          db
        ),
    };
  }

  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // LongText → Text: replace newlines with spaces
    return ok([this.replaceNewlines()]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // LongText → SingleSelect: replace newlines before auto-generating options
    const statements: TableSchemaStatementBuilder[] = [this.replaceNewlines()];
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }
    return ok(statements);
  }

  // visitMultipleSelectField is inherited from TextFieldConversionVisitor
  // which already splits on comma/newline/carriage-return (same regex).
}

/**
 * Conversion visitor for number-based fields (Number, Rating).
 * Source DB type: double precision
 */
class NumberFieldConversionVisitor extends BaseFieldConversionVisitor {
  constructor(
    params: FieldConversionParams,
    private readonly sourceField?: NumberField
  ) {
    super(params);
  }

  private buildNumberToTextExpression(): string {
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return `CASE WHEN ${col} IS NOT NULL THEN ${formatNumberStringSql(
      col,
      this.sourceField?.formatting() ?? NumberFormatting.default()
    )} ELSE NULL END`;
  }

  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeUsing('text', this.buildNumberToTextExpression())]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeUsing('text', this.buildNumberToTextExpression())]);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Number → Number: no conversion needed
    return ok([]);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Number → Rating: floor decimals to integer and clamp to [0, max]
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    const max = field.ratingMax().toNumber();
    const statements: TableSchemaStatementBuilder[] = [
      {
        scope: 'data',
        compile: () =>
          sql`UPDATE ${sql.raw(fullTableName)} SET "${sql.raw(dbFieldName)}" = GREATEST(0, LEAST(FLOOR("${sql.raw(dbFieldName)}"), ${sql.val(max)}))`.compile(
            db
          ),
      },
    ];
    return ok(statements);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Number → Checkbox: 0 = false, non-zero = true
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'boolean',
        `CASE WHEN ${col} = 0 THEN FALSE WHEN ${col} IS NOT NULL THEN TRUE ELSE NULL END`
      ),
    ]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Number → Date: interpret as Unix timestamp (milliseconds)
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'timestamptz',
        `CASE WHEN ${col} IS NOT NULL THEN to_timestamp(${col} / 1000) ELSE NULL END`
      ),
    ]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Number → SingleSelect: cast to text
    // Auto-generate options from distinct values
    const statements: TableSchemaStatementBuilder[] = [];
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }
    statements.push(this.alterColumnType('text'));
    return ok(statements);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Number → MultipleSelect: wrap as text array
    // Auto-generate options from distinct values
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const statements: TableSchemaStatementBuilder[] = [];

    // First, generate options from distinct values
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }

    // Then, wrap values in array and convert to jsonb in single ALTER
    statements.push(
      this.alterColumnTypeUsing(
        'jsonb',
        `CASE WHEN ${col} IS NOT NULL THEN jsonb_build_array(${col}::text) ELSE NULL END`
      )
    );

    return ok(statements);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitUserField(
    _field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }
}

class RatingFieldConversionVisitor extends NumberFieldConversionVisitor {
  private buildRatingToTextExpression(): string {
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return `CASE WHEN ${col} IS NOT NULL THEN (${col}::numeric)::text ELSE NULL END`;
  }

  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeUsing('text', this.buildRatingToTextExpression())]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeUsing('text', this.buildRatingToTextExpression())]);
  }
}

/**
 * Conversion visitor for checkbox fields.
 * Source DB type: boolean
 */
class CheckboxFieldConversionVisitor extends BaseFieldConversionVisitor {
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Checkbox → Text: 'true'/'false'
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'text',
        `CASE WHEN ${col} = TRUE THEN 'true' WHEN ${col} = FALSE THEN 'false' ELSE NULL END`
      ),
    ]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.visitSingleLineTextField(_field as unknown as SingleLineTextField);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Checkbox → Number: true = 1, false = 0
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'double precision',
        `CASE WHEN ${col} = TRUE THEN 1 WHEN ${col} = FALSE THEN 0 ELSE NULL END`
      ),
    ]);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Checkbox → Rating: true = max, false = 0
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const max = field.ratingMax().toNumber();
    return ok([
      this.alterColumnTypeUsing(
        'double precision',
        `CASE WHEN ${col} = TRUE THEN ${max} WHEN ${col} = FALSE THEN 0 ELSE NULL END`
      ),
    ]);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Checkbox → Date: not compatible
    return ok([this.alterColumnTypeToNull('timestamptz')]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Checkbox → SingleSelect: convert to 'true'/'false' text
    // Auto-generate options from distinct values
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const statements: TableSchemaStatementBuilder[] = [];

    // First, generate options from distinct boolean values cast to text
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }

    // Then, convert boolean to text in single ALTER
    statements.push(
      this.alterColumnTypeUsing(
        'text',
        `CASE WHEN ${col} = TRUE THEN 'true' WHEN ${col} = FALSE THEN 'false' ELSE NULL END`
      )
    );

    return ok(statements);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Checkbox → MultipleSelect: convert to ['true'] or ['false'] array
    // Auto-generate options from distinct values
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const statements: TableSchemaStatementBuilder[] = [];

    // First, generate options from distinct boolean values cast to text
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }

    // Then, convert to jsonb array in single ALTER
    statements.push(
      this.alterColumnTypeUsing(
        'jsonb',
        `CASE WHEN ${col} = TRUE THEN '["true"]'::jsonb WHEN ${col} = FALSE THEN '["false"]'::jsonb ELSE NULL END`
      )
    );

    return ok(statements);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitUserField(
    _field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }
}

/**
 * Conversion visitor for date fields.
 * Source DB type: timestamptz
 */
class DateFieldConversionVisitor extends BaseFieldConversionVisitor {
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Date → Text: ISO format
    return ok([this.alterColumnType('text')]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnType('text')]);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'double precision',
        `CASE WHEN ${col} IS NOT NULL THEN extract(epoch from ${col}) * 1000 ELSE NULL END`
      ),
    ]);
  }

  visitRatingField(
    _field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Date → Checkbox: has value = true, null = null
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing('boolean', `CASE WHEN ${col} IS NOT NULL THEN TRUE ELSE NULL END`),
    ]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Date → SingleSelect: cast to text (ISO format)
    // Auto-generate options from distinct values
    const statements: TableSchemaStatementBuilder[] = [];
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }
    statements.push(this.alterColumnType('text'));
    return ok(statements);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Date → MultipleSelect: wrap date text in array
    // Auto-generate options from distinct values
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const statements: TableSchemaStatementBuilder[] = [];

    // First, generate options from distinct values
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }

    // Then, wrap values in array and convert to jsonb in single ALTER
    statements.push(
      this.alterColumnTypeUsing(
        'jsonb',
        `CASE WHEN ${col} IS NOT NULL THEN jsonb_build_array(${col}::text) ELSE NULL END`
      )
    );

    return ok(statements);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitUserField(
    _field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('jsonb')]);
  }
}

/**
 * Conversion visitor for single select fields.
 * Source DB type: text
 */
class SelectFieldConversionVisitor extends TextFieldConversionVisitor {
  // SingleSelect uses text, so inherit from TextFieldConversionVisitor
}

/**
 * Conversion visitor for multiple select fields.
 * Source DB type: jsonb (array of strings)
 */
class MultipleSelectFieldConversionVisitor extends BaseFieldConversionVisitor {
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // MultipleSelect → Text: join array elements with comma separator
    // Cannot use subquery in ALTER COLUMN USING, so use text manipulation:
    // jsonb::text gives '["Red", "Blue"]', btrim strips [], replace strips quotes
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'text',
        `CASE WHEN ${col} IS NOT NULL AND jsonb_array_length(${col}::jsonb) > 0 THEN replace(btrim(${col}::text, '[]'), '"', '') ELSE NULL END`
      ),
    ]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.visitSingleLineTextField(_field as unknown as SingleLineTextField);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitRatingField(
    _field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // MultipleSelect → Checkbox: has items = true
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'boolean',
        `CASE WHEN ${col} IS NOT NULL AND jsonb_array_length(${col}::jsonb) > 0 THEN TRUE ELSE NULL END`
      ),
    ]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('timestamptz')]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // MultipleSelect → SingleSelect: take first item
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const statements: TableSchemaStatementBuilder[] = [];

    const optionsStatement = buildSelectOptionsFromValuesStatement(
      this.params,
      `SELECT DISTINCT value::text AS name
       FROM ${this.fullTableName}, jsonb_array_elements_text(${col}) AS value
       WHERE ${col} IS NOT NULL`
    );
    if (optionsStatement) {
      statements.push(optionsStatement);
    }

    statements.push(
      this.alterColumnTypeUsing(
        'text',
        `CASE WHEN ${col} IS NOT NULL AND jsonb_array_length(${col}::jsonb) > 0 THEN ${col}::jsonb->>0 ELSE NULL END`
      )
    );

    return ok(statements);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Same DB type (jsonb), just nullify incompatible data
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }

  visitUserField(
    _field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Same DB type (jsonb), just nullify incompatible data
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Same DB type (jsonb), just nullify incompatible data
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }
}

/**
 * Conversion visitor for JSONB fields (Attachment, User, Button).
 * Source DB type: jsonb
 */
class JsonFieldConversionVisitor extends BaseFieldConversionVisitor {
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // JSONB → Text: stringify (simple cast)
    return ok([this.alterColumnType('text')]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.visitSingleLineTextField(_field as unknown as SingleLineTextField);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitRatingField(
    _field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing('boolean', `CASE WHEN ${col} IS NOT NULL THEN TRUE ELSE NULL END`),
    ]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([this.alterColumnTypeToNull('timestamptz')]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.visitSingleLineTextField(_field as unknown as SingleLineTextField);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Same DB type (jsonb), just nullify incompatible data
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }

  visitUserField(
    _field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Same DB type (jsonb), just nullify incompatible data
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Same DB type (jsonb), just nullify incompatible data
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }
}

/**
 * Conversion visitor for User fields.
 * Source DB type: jsonb
 *
 * User field structure:
 * - Single: {"id": "...", "title": "...", "email": "...", "avatarUrl": "..."}
 * - Multiple: [{"id": "...", "title": "...", "email": "...", "avatarUrl": "..."}, ...]
 */
class UserFieldConversionVisitor extends BaseFieldConversionVisitor {
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Text: Extract user's title (name), or email as fallback
    // For multiple users: join titles with comma.
    // PostgreSQL forbids subqueries in ALTER ... USING expressions, so we first UPDATE
    // jsonb values to {"v": "..."} payloads, then ALTER with a subquery-free expression.
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    const col = `"${dbFieldName}"`;
    return ok([
      {
        scope: 'data',
        compile: () =>
          sql`UPDATE ${sql.raw(fullTableName)}
              SET ${sql.raw(col)} = CASE
                WHEN ${sql.raw(col)} IS NULL THEN NULL
                WHEN jsonb_typeof(${sql.raw(col)}) = 'array' THEN jsonb_build_object(
                  'v',
                  (
                    SELECT string_agg(COALESCE(elem->>'title', elem->>'email', elem->>'id'), ', ')
                    FROM jsonb_array_elements(${sql.raw(col)}) AS elem
                  )
                )
                ELSE jsonb_build_object(
                  'v',
                  COALESCE(
                    ${sql.raw(col)}->>'title',
                    ${sql.raw(col)}->>'email',
                    ${sql.raw(col)}->>'id'
                  )
                )
              END`.compile(db),
      },
      this.alterColumnTypeUsing('text', `CASE WHEN ${col} IS NULL THEN NULL ELSE ${col}->>'v' END`),
    ]);
  }

  visitLongTextField(
    _field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.visitSingleLineTextField(_field as unknown as SingleLineTextField);
  }

  visitNumberField(
    _field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Number: not compatible
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitRatingField(
    _field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Rating: not compatible
    return ok([this.alterColumnTypeToNull('double precision')]);
  }

  visitCheckboxField(
    _field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Checkbox: has user = true
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    return ok([
      this.alterColumnTypeUsing(
        'boolean',
        `CASE
          WHEN ${col} IS NULL THEN NULL
          WHEN jsonb_typeof(${col}) = 'array' AND jsonb_array_length(${col}) > 0 THEN TRUE
          WHEN jsonb_typeof(${col}) = 'object' THEN TRUE
          ELSE NULL
        END`
      ),
    ]);
  }

  visitDateField(
    _field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Date: not compatible
    return ok([this.alterColumnTypeToNull('timestamptz')]);
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Auto-generate options from distinct user titles
    const { db, dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const fullTableName = this.fullTableName;
    const statements: TableSchemaStatementBuilder[] = [];

    statements.push({
      scope: 'data',
      compile: () =>
        sql`UPDATE ${sql.raw(fullTableName)}
            SET ${sql.raw(col)} = CASE
              WHEN ${sql.raw(col)} IS NULL THEN NULL
              WHEN jsonb_typeof(${sql.raw(col)}) = 'array' THEN jsonb_build_object(
                'v',
                (
                  SELECT string_agg(COALESCE(elem->>'title', elem->>'email', elem->>'id'), ', ')
                  FROM jsonb_array_elements(${sql.raw(col)}) AS elem
                )
              )
              ELSE jsonb_build_object(
                'v',
                COALESCE(
                  ${sql.raw(col)}->>'title',
                  ${sql.raw(col)}->>'email',
                  ${sql.raw(col)}->>'id'
                )
              )
            END`.compile(db),
    });
    statements.push(
      this.alterColumnTypeUsing('text', `CASE WHEN ${col} IS NULL THEN NULL ELSE ${col}->>'v' END`)
    );

    // Generate options from distinct values
    const optionsGenerator = this.generateSelectOptionsFromValues();
    if (optionsGenerator) {
      statements.push(optionsGenerator);
    }

    return ok(statements);
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → MultipleSelect: Extract user titles as array
    // Auto-generate options from distinct user titles
    const { db, dbFieldName } = this.params;
    const fullTableName = this.fullTableName;
    const statements: TableSchemaStatementBuilder[] = [];

    // Convert user objects to array of title strings
    statements.push({
      scope: 'data',
      compile: () =>
        sql`UPDATE ${sql.raw(fullTableName)} SET "${sql.raw(dbFieldName)}" = CASE
          WHEN "${sql.raw(dbFieldName)}" IS NULL THEN NULL
          WHEN jsonb_typeof("${sql.raw(dbFieldName)}") = 'array' THEN (
            SELECT jsonb_agg(COALESCE(elem->>'title', elem->>'email', elem->>'id'))
            FROM jsonb_array_elements("${sql.raw(dbFieldName)}") AS elem
          )
          WHEN jsonb_typeof("${sql.raw(dbFieldName)}") = 'object' THEN
            jsonb_build_array(COALESCE("${sql.raw(dbFieldName)}"->>'title', "${sql.raw(dbFieldName)}"->>'email', "${sql.raw(dbFieldName)}"->>'id'))
          ELSE NULL
        END`.compile(db),
    });

    // Generate options from distinct values in the array
    // Note: For multipleSelect, we need to unnest the arrays to get distinct values
    const optionsStatement = buildSelectOptionsFromValuesStatement(
      this.params,
      `SELECT DISTINCT value::text AS name
       FROM ${fullTableName}, jsonb_array_elements_text("${dbFieldName}") AS value
       WHERE "${dbFieldName}" IS NOT NULL`
    );
    if (optionsStatement) {
      statements.push(optionsStatement);
    }

    return ok(statements);
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Attachment: not compatible, same DB type (jsonb)
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }

  visitUserField(
    targetField: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → User: Handle isMultiple toggle
    // This handles the case where a single user field becomes multiple or vice versa
    const { dbFieldName } = this.params;
    const col = `"${dbFieldName}"`;
    const targetIsMultiple = targetField.multiplicity().toBoolean();

    // Use ALTER USING for data transformation even though type is same (jsonb)
    if (targetIsMultiple) {
      // Single → Multiple: Wrap single object in array
      return ok([
        this.alterColumnTypeUsing(
          'jsonb',
          `CASE
            WHEN ${col} IS NULL THEN NULL
            WHEN jsonb_typeof(${col}) = 'array' THEN ${col}
            WHEN jsonb_typeof(${col}) = 'object' THEN jsonb_build_array(${col})
            ELSE NULL
          END`
        ),
      ]);
    } else {
      // Multiple → Single: Extract first element
      return ok([
        this.alterColumnTypeUsing(
          'jsonb',
          `CASE
            WHEN ${col} IS NULL THEN NULL
            WHEN jsonb_typeof(${col}) = 'object' THEN ${col}
            WHEN jsonb_typeof(${col}) = 'array' AND jsonb_array_length(${col}) > 0 THEN ${col}->0
            ELSE NULL
          END`
        ),
      ]);
    }
  }

  visitButtonField(
    _field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // User → Button: not compatible, same DB type (jsonb)
    return ok([this.alterColumnTypeUsing('jsonb', 'NULL')]);
  }
}

/**
 * Check if a field type requires schema recreation for conversion.
 * These are fields where simple data conversion + ALTER COLUMN is not sufficient.
 */
function requiresSchemaRecreation(field: Field): boolean {
  const type = field.type().toString();
  // Computed fields have special storage (generated columns, etc.)
  // Link fields have special storage (junction tables, FK columns)
  // AutoNumber has sequences
  // System fields have special behavior
  return [
    'formula',
    'rollup',
    'lookup',
    'conditionalRollup',
    'conditionalLookup',
    'link',
    'autoNumber',
    'createdTime',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
  ].includes(type);
}

/**
 * Generate SQL statements to convert field data from one type to another.
 *
 * @param params - Conversion parameters including db connection and column info
 * @param oldField - The source field being converted from
 * @param newField - The target field being converted to
 * @returns SQL statements for data conversion and column type change
 */
export function generateFieldConversionStatements(
  params: FieldConversionParams,
  oldField: Field,
  newField: Field
): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
  return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
    // Preserve scalar source values when converting to single-value links.
    // We rename the old column to a temp column, recreate link schema, map FK by lookup value,
    // then drop the temp column.
    const isNewLink = newField.type().toString() === 'link';
    const isOldLink = oldField.type().toString() === 'link';
    if (isNewLink && isOldLink) {
      const oldLinkField = oldField as LinkField;
      const newLinkField = newField as LinkField;
      const foreignChanged = !oldLinkField.foreignTableId().equals(newLinkField.foreignTableId());
      if (foreignChanged) {
        const statements = yield* buildLinkToLinkForeignTableMigrationStatements(
          params,
          oldLinkField,
          newLinkField
        );
        return ok(statements);
      }
    }

    if (isOldLink && !isNewLink) {
      const newType = newField.type().toString();
      if (newType === 'singleLineText' || newType === 'longText') {
        const statements = yield* buildLinkToTextMigrationStatements(
          params,
          oldField as LinkField,
          newField
        );
        return ok(statements);
      }
      if (newType === 'singleSelect' || newType === 'multipleSelect') {
        const statements = yield* buildLinkToSelectMigrationStatements(
          params,
          oldField as LinkField,
          newField as SingleSelectField | MultipleSelectField
        );
        return ok(statements);
      }
    }

    if (isNewLink && !isOldLink) {
      const newLinkField = newField as LinkField;
      const oldType = oldField.type().toString();
      const isScalarSource =
        oldType === 'singleLineText' || oldType === 'longText' || oldType === 'singleSelect';
      if (isScalarSource) {
        const statements = yield* buildScalarToLinkMigrationStatements(
          params,
          oldField,
          newLinkField
        );
        return ok(statements);
      }
    }

    // Formula → any type: preserve cell values during conversion
    const isOldFormula = oldField.type().toString() === 'formula';
    if (isOldFormula) {
      const statements = yield* buildFormulaMigrationStatements(
        params,
        oldField as FormulaField,
        newField
      );
      return ok(statements);
    }

    const isOldLookup =
      oldField.type().toString() === 'lookup' || oldField.type().toString() === 'conditionalLookup';
    if (isOldLookup && isBasicLookupConversionTarget(newField)) {
      const statements = yield* buildLookupToBasicFieldMigrationStatements(
        params,
        oldField as LookupField | ConditionalLookupField,
        newField as BasicLookupConversionTargetField
      );
      return ok(statements);
    }

    const needsRecreation =
      requiresSchemaRecreation(oldField) || requiresSchemaRecreation(newField);

    if (needsRecreation) {
      // For incompatible conversions, use drop + create approach
      // Use forConversion (not forSchemaUpdate) so ReferenceRule only removes
      // inbound references (to_field_id), preserving outbound edges (from_field_id)
      // that other dependent fields rely on for cascade propagation.
      const deleteVisitor = PostgresTableSchemaFieldDeleteVisitor.forConversion({
        db: params.db,
        schema: params.schema,
        tableName: params.tableName,
        tableId: params.tableId,
      });

      const createVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate({
        db: params.db,
        schema: params.schema,
        tableName: params.tableName,
        tableId: params.tableId,
      });

      // 1. Drop old field schema
      const dropStatements = yield* oldField.accept(deleteVisitor);
      // 2. Create new field schema
      const createStatements = yield* newField.accept(createVisitor);

      return ok([...dropStatements, ...createStatements]);
    }

    // For compatible conversions, use the data conversion + ALTER COLUMN approach
    // 1. Get the conversion visitor factory based on the old field type
    const factory = new FieldTypeConversionVisitorFactory(params);
    const conversionVisitor = yield* oldField.accept(factory);

    // 2. Generate conversion statements based on the new field type
    const statements = yield* newField.accept(conversionVisitor);

    return ok(statements);
  });
}
