import {
  domainError,
  SearchVectorFieldContributionVisitor,
  type DomainError,
  type SearchVectorFieldContribution,
  type Table,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type TableSearchVectorFieldDefinition = SearchVectorFieldContribution & {
  readonly included: true;
  readonly fieldDbName: string;
  readonly textProjection: 'text_cast';
};

export type TableSearchVectorDefinition = {
  readonly tableId: string;
  readonly baseId: string;
  readonly languageConfig: string;
  readonly scope: 'all_fields' | 'selected_fields';
  readonly accessPath: 'generated_tsvector' | 'none';
  readonly indexKind: 'gin_tsvector' | 'none';
  readonly definitionKey: string;
  readonly fields: readonly TableSearchVectorFieldDefinition[];
  readonly skippedFields: readonly SearchVectorFieldContribution[];
};

export type BuildTableSearchVectorDefinitionOptions = {
  readonly languageConfig?: string;
  readonly fieldIds?: readonly string[];
};

const languageConfigPattern = /^[\w.]+$/;

export const buildTableSearchVectorDefinition = (
  table: Table,
  options: BuildTableSearchVectorDefinitionOptions = {}
): Result<TableSearchVectorDefinition, DomainError> => {
  const languageConfig = options.languageConfig?.trim() || 'simple';
  if (!languageConfigPattern.test(languageConfig)) {
    return err(domainError.validation({ message: 'Invalid search vector language config' }));
  }

  const selectedIds = options.fieldIds?.length ? new Set(options.fieldIds) : undefined;
  const visitor = new SearchVectorFieldContributionVisitor();
  const fields: TableSearchVectorFieldDefinition[] = [];
  const skippedFields: SearchVectorFieldContribution[] = [];

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
  const definitionKey = `${tableId}:${languageConfig}:${fields
    .map((field) => `${field.fieldId}=${field.fieldDbName}`)
    .join(',')}`;

  return ok({
    tableId,
    baseId: table.baseId().toString(),
    languageConfig,
    scope: selectedIds ? 'selected_fields' : 'all_fields',
    accessPath: fields.length > 0 ? 'generated_tsvector' : 'none',
    indexKind: fields.length > 0 ? 'gin_tsvector' : 'none',
    definitionKey,
    fields,
    skippedFields,
  });
};
