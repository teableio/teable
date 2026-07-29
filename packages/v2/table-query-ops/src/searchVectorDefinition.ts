import {
  domainError,
  SearchDocumentFieldContributionVisitor,
  type DomainError,
  type SearchDocumentFieldContribution,
  type Table,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type TableSearchDocumentFieldDefinition = SearchDocumentFieldContribution & {
  readonly included: true;
  readonly fieldDbName: string;
  readonly textProjection: 'text_cast';
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

const languageConfigPattern = /^[\w.]+$/;

export const buildTableSearchAccessPathDefinition = (
  table: Table,
  options: BuildTableSearchAccessPathDefinitionOptions = {}
): Result<TableSearchAccessPathDefinition, DomainError> => {
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

  const selectedIds = options.fieldIds?.length ? new Set(options.fieldIds) : undefined;
  const visitor = new SearchDocumentFieldContributionVisitor();
  const fields: TableSearchDocumentFieldDefinition[] = [];
  const skippedFields: SearchDocumentFieldContribution[] = [];

  for (const field of table.getFields()) {
    const fieldId = field.id().toString();
    if (selectedIds && !selectedIds.has(fieldId)) continue;

    const contribution = field.accept(visitor);
    if (contribution.isErr()) return err(contribution.error);
    if (!contribution.value.included) {
      skippedFields.push(contribution.value);
      continue;
    }

    const dbFieldName = field.dbFieldName().andThen((name) => name.value());
    if (dbFieldName.isErr()) {
      skippedFields.push({
        ...contribution.value,
        included: false,
        skippedReason: 'unsupported_search_field_type',
      });
      continue;
    }

    fields.push({
      ...contribution.value,
      included: true,
      fieldDbName: dbFieldName.value,
      textProjection: 'text_cast',
    });
  }

  const tableId = table.id().toString();
  const definitionKey = `${tableId}:${semantics}:${provider}:${
    semantics === 'lexical' ? languageConfig : 'none'
  }:${fields.map((field) => `${field.fieldId}=${field.fieldDbName}`).join(',')}`;

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
    indexKind:
      fields.length > 0
        ? provider === 'pg_bigm'
          ? 'gin_bigm'
          : provider === 'pg_trgm'
            ? 'gin_trgm'
            : 'gin_tsvector'
        : 'none',
    definitionKey,
    fields,
    skippedFields,
  });
};

export type TableSearchVectorFieldDefinition = TableSearchDocumentFieldDefinition;
export type TableSearchVectorDefinition = TableSearchAccessPathDefinition;
export type BuildTableSearchVectorDefinitionOptions = BuildTableSearchAccessPathDefinitionOptions;
export const buildTableSearchVectorDefinition = buildTableSearchAccessPathDefinition;
