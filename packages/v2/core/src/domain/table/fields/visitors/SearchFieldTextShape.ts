import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../Field';
import { FieldType } from '../FieldType';
import { CellValueType } from '../types/CellValueType';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import { DateTimeFormatting } from '../types/DateTimeFormatting';
import type { FormulaField } from '../types/FormulaField';
import type { LookupField } from '../types/LookupField';
import type { NumberField } from '../types/NumberField';
import type { NumberFormatting } from '../types/NumberFormatting';
import type { RollupField } from '../types/RollupField';
import { FieldValueTypeVisitor } from './FieldValueTypeVisitor';

/**
 * Canonical per-field text shape for substring search.
 *
 * Every SQL consumer — the default ILIKE predicate, the generated
 * search-document column, and the scoped recheck expressions — derives its
 * projection from this one shape. That single source is what guarantees the
 * indexed document prefilter is a superset of the exact predicate: both sides
 * project a cell to the same text before matching.
 */
export type SearchFieldTextProjection =
  | { readonly kind: 'plain' }
  | { readonly kind: 'multiline' }
  | { readonly kind: 'plain_list' }
  | { readonly kind: 'structured_title' }
  | { readonly kind: 'structured_title_list' }
  | { readonly kind: 'rounded_number'; readonly precision: number }
  | { readonly kind: 'rounded_number_list'; readonly precision: number };

export type SearchFieldTextShape =
  | SearchFieldTextProjection
  | { readonly kind: 'none' }
  | { readonly kind: 'date_range' };

const projectionKinds: ReadonlySet<string> = new Set([
  'plain',
  'multiline',
  'plain_list',
  'structured_title',
  'structured_title_list',
  'rounded_number',
  'rounded_number_list',
]);

export const isSearchFieldTextProjection = (
  shape: SearchFieldTextShape
): shape is SearchFieldTextProjection => projectionKinds.has(shape.kind);

export const searchFieldTextProjectionKey = (projection: SearchFieldTextProjection): string =>
  'precision' in projection ? `${projection.kind}(${projection.precision})` : projection.kind;

const fieldValueTypeVisitor = new FieldValueTypeVisitor();

export const resolveSearchShapeSourceField = (field: Field): Field => {
  if (
    field.type().equals(FieldType.lookup()) ||
    field.type().equals(FieldType.conditionalLookup())
  ) {
    const innerField = field.type().equals(FieldType.lookup())
      ? (field as LookupField).innerField()
      : (field as ConditionalLookupField).innerField();
    if (innerField.isOk()) {
      return resolveSearchShapeSourceField(innerField.value);
    }
  }

  return field;
};

const isStructuredStringField = (field: Field): boolean => {
  const sourceField = resolveSearchShapeSourceField(field);
  return (
    sourceField.type().equals(FieldType.user()) ||
    sourceField.type().equals(FieldType.createdBy()) ||
    sourceField.type().equals(FieldType.lastModifiedBy()) ||
    sourceField.type().equals(FieldType.link()) ||
    sourceField.type().equals(FieldType.attachment())
  );
};

const isLongTextField = (field: Field): boolean => {
  return resolveSearchShapeSourceField(field).type().equals(FieldType.longText());
};

export const resolveSearchNumberFormatting = (field: Field): NumberFormatting | undefined => {
  if (
    field.type().equals(FieldType.lookup()) ||
    field.type().equals(FieldType.conditionalLookup())
  ) {
    const innerField = field.type().equals(FieldType.lookup())
      ? (field as LookupField).innerField()
      : (field as ConditionalLookupField).innerField();
    return innerField.isOk() ? resolveSearchNumberFormatting(innerField.value) : undefined;
  }

  if (field.type().equals(FieldType.number())) {
    return (field as NumberField).formatting();
  }

  if (
    field.type().equals(FieldType.formula()) ||
    field.type().equals(FieldType.rollup()) ||
    field.type().equals(FieldType.conditionalRollup())
  ) {
    const formatting = field.type().equals(FieldType.formula())
      ? (field as FormulaField).formatting()
      : field.type().equals(FieldType.rollup())
        ? (field as RollupField).formatting()
        : (field as ConditionalRollupField).formatting();

    return formatting instanceof DateTimeFormatting ? undefined : formatting;
  }

  return undefined;
};

export const resolveSearchNumberPrecision = (field: Field): number => {
  return resolveSearchNumberFormatting(field)?.precision().toNumber() ?? 0;
};

export const resolveSearchFieldTextShape = (
  field: Field
): Result<SearchFieldTextShape, DomainError> => {
  if (field.type().equals(FieldType.button())) {
    return ok({ kind: 'none' });
  }

  return field.accept(fieldValueTypeVisitor).map(({ cellValueType, isMultipleCellValue }) => {
    const isMultiple = isMultipleCellValue.isMultiple();

    if (isStructuredStringField(field)) {
      return isMultiple
        ? ({ kind: 'structured_title_list' } as const)
        : ({ kind: 'structured_title' } as const);
    }

    if (cellValueType.equals(CellValueType.boolean())) {
      return { kind: 'none' } as const;
    }

    if (cellValueType.equals(CellValueType.number())) {
      const precision = resolveSearchNumberPrecision(field);
      return isMultiple
        ? ({ kind: 'rounded_number_list', precision } as const)
        : ({ kind: 'rounded_number', precision } as const);
    }

    if (cellValueType.equals(CellValueType.dateTime())) {
      return { kind: 'date_range' } as const;
    }

    if (isMultiple) {
      return { kind: 'plain_list' } as const;
    }

    if (isLongTextField(field)) {
      return { kind: 'multiline' } as const;
    }

    return { kind: 'plain' } as const;
  });
};

/**
 * New v1 per-field `idx_trgm_*` indexes only cover
 * singleLineText, longText, and string formula/lookup (plain / multiline).
 * Generated search documents instead include all canonical text projections.
 *
 * Keep in sync with FieldFormatter.getIndexSpec in
 * `search-index-builder.postgres.ts`. Attachment, link JSON, number/rating,
 * selects, user JSON, button, checkbox, and dateTime stay out; link titles
 * are excluded by default.
 */
export const isAllowedSubstringSearchIndexProjection = (
  field: Field,
  shape: SearchFieldTextShape
): shape is Extract<SearchFieldTextProjection, { kind: 'plain' | 'multiline' }> => {
  if (shape.kind !== 'plain' && shape.kind !== 'multiline') {
    return false;
  }

  const sourceType = resolveSearchShapeSourceField(field).type();
  if (sourceType.equals(FieldType.singleLineText()) || sourceType.equals(FieldType.longText())) {
    return true;
  }

  return sourceType.equals(FieldType.formula()) || field.type().equals(FieldType.formula());
};
