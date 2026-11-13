import {
  domainError,
  SearchDocumentFieldContributionVisitor,
  searchFieldTextProjectionKey,
  type DomainError,
  type SearchDocumentFieldContribution,
  type SearchFieldTextProjection,
  type ITableReadModel,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type TableSearchDocumentFieldDefinition = SearchDocumentFieldContribution & {
  readonly included: true;
  readonly fieldDbName: string;
  readonly textProjection: SearchFieldTextProjection;
};

export type TableSearchAccessPathDefinition = {
  readonly tableId: string;
  readonly baseId: string;
  readonly semantics: 'substring' | 'lexical';
  readonly provider: 'pg_trgm' | 'pg_bigm' | 'tsvector';
  readonly languageConfig?: string;
  readonly scope: 'all_fields' | 'selected_fields';
  readonly accessPath: 'generated_text' | 'generated_tsvector' | 'none';
  readonly indexKind: 'gin_trgm' | 'gin_bigm' | 'gin_tsvector' | 'none';
  readonly definitionKey: string;
  readonly fields: readonly TableSearchDocumentFieldDefinition[];
  readonly skippedFields: readonly SearchDocumentFieldContribution[];
};

export type BuildTableSearchAccessPathDefinitionOptions = {
  readonly semantics?: 'substring' | 'lexical';
  readonly provider?: 'pg_trgm' | 'pg_bigm' | 'tsvector';
  readonly languageConfig?: string;
  readonly fieldIds?: readonly string[];
  /**
   * Field ids the caller knows are physically unusable in a generated document — a column that is
   * `GENERATED` in PostgreSQL while its field meta says otherwise (legacy createdBy columns, drifted
   * formulas). They are skipped with `generated_column_dependency` instead of failing the DDL.
   */
  readonly excludeFieldIds?: readonly string[];
};

const languageConfigPattern = /^[\w.]+$/;

type ResolvedDefinitionOptions = {
  readonly semantics: 'substring' | 'lexical';
  readonly provider: 'pg_trgm' | 'pg_bigm' | 'tsvector';
  readonly languageConfig: string;
};

const resolveDefinitionOptions = (
  options: BuildTableSearchAccessPathDefinitionOptions
): Result<ResolvedDefinitionOptions, DomainError> => {
  const semantics = options.semantics ?? 'substring';
  const provider = options.provider ?? (semantics === 'lexical' ? 'tsvector' : 'pg_trgm');
  if (semantics === 'substring' && provider === 'tsvector') {
    return err(domainError.validation({ message: 'Substring search requires an n-gram provider' }));
  }
  if (semantics === 'lexical' && provider !== 'tsvector') {
    return err(
      domainError.validation({ message: 'Lexical search requires the tsvector provider' })
    );
  }
  const languageConfig = options.languageConfig?.trim() || 'simple';
  if (!languageConfigPattern.test(languageConfig)) {
    return err(domainError.validation({ message: 'Invalid search vector language config' }));
  }
  return ok({ semantics, provider, languageConfig });
};

type CollectedDocumentFields = {
  readonly fields: readonly TableSearchDocumentFieldDefinition[];
  readonly skippedFields: readonly SearchDocumentFieldContribution[];
};

const skippedContribution = (
  contribution: SearchDocumentFieldContribution
): SearchDocumentFieldContribution => ({
  ...contribution,
  included: false,
  skippedReason: 'unsupported_search_field_type',
});

const collectSearchDocumentFields = (
  table: ITableReadModel,
  selectedIds: ReadonlySet<string> | undefined
): Result<CollectedDocumentFields, DomainError> => {
  const visitor = new SearchDocumentFieldContributionVisitor();
  const fields: TableSearchDocumentFieldDefinition[] = [];
  const skippedFields: SearchDocumentFieldContribution[] = [];

  for (const field of table.getFields()) {
    if (selectedIds && !selectedIds.has(field.id().toString())) continue;

    const contribution = field.accept(visitor);
    if (contribution.isErr()) return err(contribution.error);
    if (!contribution.value.included) {
      skippedFields.push(contribution.value);
      continue;
    }

    const dbFieldName = field.dbFieldName().andThen((name) => name.value());
    const textProjection = contribution.value.textProjection;
    if (dbFieldName.isErr() || !textProjection) {
      skippedFields.push(skippedContribution(contribution.value));
      continue;
    }

    fields.push({
      ...contribution.value,
      included: true,
      fieldDbName: dbFieldName.value,
      textProjection,
    });
  }

  return ok({ fields, skippedFields });
};

const buildDefinitionKey = (
  tableId: string,
  resolved: ResolvedDefinitionOptions,
  fields: readonly TableSearchDocumentFieldDefinition[]
): string =>
  `${tableId}:${resolved.semantics}:${resolved.provider}:${
    resolved.semantics === 'lexical' ? resolved.languageConfig : 'none'
  }:${fields
    .map(
      (field) =>
        `${field.fieldId}=${field.fieldDbName}:${searchFieldTextProjectionKey(field.textProjection)}`
    )
    .join(',')}`;

const resolveIndexKind = (
  provider: ResolvedDefinitionOptions['provider'],
  hasFields: boolean
): TableSearchAccessPathDefinition['indexKind'] => {
  if (!hasFields) return 'none';
  if (provider === 'pg_bigm') return 'gin_bigm';
  return provider === 'pg_trgm' ? 'gin_trgm' : 'gin_tsvector';
};

export type TableSearchDocumentCoverage = {
  readonly searchableFieldIds: readonly string[];
  readonly coveredFieldIds: readonly string[];
  readonly uncoveredFieldIds: readonly string[];
};

/**
 * Which searchable fields the serving document covers. The covered ids come from the published
 * configuration; the searchable set is re-derived from the current table, so a field created after
 * the document was built is reported as uncovered instead of silently missing from search.
 */
export const resolveTableSearchDocumentCoverage = (
  table: ITableReadModel,
  coveredFieldIds: readonly string[]
): Result<TableSearchDocumentCoverage, DomainError> => {
  const collected = collectSearchDocumentFields(table, undefined);
  if (collected.isErr()) return err(collected.error);

  const searchableFieldIds = collected.value.fields.map((field) => field.fieldId);
  const covered = new Set(coveredFieldIds);
  return ok({
    searchableFieldIds,
    coveredFieldIds: searchableFieldIds.filter((fieldId) => covered.has(fieldId)),
    uncoveredFieldIds: searchableFieldIds.filter((fieldId) => !covered.has(fieldId)),
  });
};

export const buildTableSearchAccessPathDefinition = (
  table: ITableReadModel,
  options: BuildTableSearchAccessPathDefinitionOptions = {}
): Result<TableSearchAccessPathDefinition, DomainError> => {
  const resolvedOptions = resolveDefinitionOptions(options);
  if (resolvedOptions.isErr()) return err(resolvedOptions.error);
  const { semantics, provider, languageConfig } = resolvedOptions.value;

  const selectedIds = options.fieldIds?.length ? new Set(options.fieldIds) : undefined;
  const collected = collectSearchDocumentFields(table, selectedIds);
  if (collected.isErr()) return err(collected.error);
  // Every searchable field joins the document, however wide the table is: refusing wide tables
  // left them with no document at all, which is strictly worse than a large one.
  const excluded = new Set(options.excludeFieldIds ?? []);
  const { fields, skippedFields } = collected.value;
  const unusableFields = excluded.size ? fields.filter((field) => excluded.has(field.fieldId)) : [];
  const usableFields = excluded.size
    ? fields.filter((field) => !excluded.has(field.fieldId))
    : fields;

  const tableId = table.id().toString();
  return ok({
    tableId,
    baseId: table.baseId().toString(),
    semantics,
    provider,
    ...(semantics === 'lexical' ? { languageConfig } : {}),
    scope: selectedIds ? 'selected_fields' : 'all_fields',
    accessPath:
      usableFields.length > 0
        ? semantics === 'substring'
          ? 'generated_text'
          : 'generated_tsvector'
        : 'none',
    indexKind: resolveIndexKind(provider, usableFields.length > 0),
    definitionKey: buildDefinitionKey(tableId, resolvedOptions.value, usableFields),
    fields: usableFields,
    skippedFields: [
      ...skippedFields,
      ...unusableFields.map((field) => ({
        fieldId: field.fieldId,
        fieldType: field.fieldType,
        ...(field.valueType ? { valueType: field.valueType } : {}),
        included: false as const,
        skippedReason: 'generated_column_dependency' as const,
      })),
    ],
  });
};

export type TableSearchVectorFieldDefinition = TableSearchDocumentFieldDefinition;
export type TableSearchVectorDefinition = TableSearchAccessPathDefinition;
export type BuildTableSearchVectorDefinitionOptions = BuildTableSearchAccessPathDefinitionOptions;
export const buildTableSearchVectorDefinition = buildTableSearchAccessPathDefinition;
