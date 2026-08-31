import {
  domainError,
  SearchDocumentFieldContributionVisitor,
  searchFieldTextProjectionKey,
  type DomainError,
  type SearchDocumentFieldContribution,
  type SearchFieldTextProjection,
  type Table,
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
};

/** All-field generated documents are refused at or above these sizes. */
export const WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_FIELD_COUNT = 30;
export const WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT = 20;
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
  table: Table,
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

const refuseWideTableAllFieldDocument = (
  collected: CollectedDocumentFields
): CollectedDocumentFields => ({
  fields: [],
  skippedFields: [
    ...collected.skippedFields,
    ...collected.fields.map((field) => ({
      fieldId: field.fieldId,
      fieldType: field.fieldType,
      ...(field.valueType ? { valueType: field.valueType } : {}),
      included: false as const,
      skippedReason: 'wide_table_all_field_document' as const,
    })),
  ],
});

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

export const buildTableSearchAccessPathDefinition = (
  table: Table,
  options: BuildTableSearchAccessPathDefinitionOptions = {}
): Result<TableSearchAccessPathDefinition, DomainError> => {
  const resolvedOptions = resolveDefinitionOptions(options);
  if (resolvedOptions.isErr()) return err(resolvedOptions.error);
  const { semantics, provider, languageConfig } = resolvedOptions.value;

  const selectedIds = options.fieldIds?.length ? new Set(options.fieldIds) : undefined;
  const collected = collectSearchDocumentFields(table, selectedIds);
  if (collected.isErr()) return err(collected.error);
  const wideTableAllFieldDocument =
    !selectedIds &&
    (table.getFields().length >= WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_FIELD_COUNT ||
      collected.value.fields.length >= WIDE_TABLE_ALL_FIELD_DOCUMENT_MIN_SEARCHABLE_COUNT);
  const { fields, skippedFields } = wideTableAllFieldDocument
    ? refuseWideTableAllFieldDocument(collected.value)
    : collected.value;

  const tableId = table.id().toString();
  return ok({
    tableId,
    baseId: table.baseId().toString(),
    semantics,
    provider,
    ...(semantics === 'lexical' ? { languageConfig } : {}),
    scope: selectedIds ? 'selected_fields' : 'all_fields',
    accessPath:
      fields.length > 0
        ? semantics === 'substring'
          ? 'generated_text'
          : 'generated_tsvector'
        : 'none',
    indexKind: resolveIndexKind(provider, fields.length > 0),
    definitionKey: buildDefinitionKey(tableId, resolvedOptions.value, fields),
    fields,
    skippedFields,
  });
};

export type TableSearchVectorFieldDefinition = TableSearchDocumentFieldDefinition;
export type TableSearchVectorDefinition = TableSearchAccessPathDefinition;
export type BuildTableSearchVectorDefinitionOptions = BuildTableSearchAccessPathDefinitionOptions;
export const buildTableSearchVectorDefinition = buildTableSearchAccessPathDefinition;
