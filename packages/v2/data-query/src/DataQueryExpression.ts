import { FieldId } from '@teable/v2-core';
import { z } from 'zod';
import type { DataQueryFilterLeaf, DataQuerySystemField } from './types';

export const dataQueryExpressionLimits = Object.freeze({ depth: 16, nodes: 128 } as const);
export type DataQueryFormulaReference =
  | { type: 'field'; fieldId: string; source?: string }
  | { type: 'system'; system: DataQuerySystemField; source?: string }
  | { type: 'parameter'; name: string };
export type DataQueryFormulaExpression = {
  type: 'formula';
  formula: string;
  references: Record<string, DataQueryFormulaReference>;
  timeZone?: string;
};
/** Aggregate output stage: no stored fields, systems or implicit source row. */
export type DataQueryHavingReference =
  | { type: 'output'; alias: string }
  | { type: 'parameter'; name: string };
export type DataQueryHavingExpression = Omit<DataQueryFormulaExpression, 'references'> & {
  references: Record<string, DataQueryHavingReference>;
};
export type DataQueryPredicateV3 =
  | { conjunction: 'and' | 'or'; items: DataQueryPredicateV3[] }
  | { not: DataQueryPredicateV3 }
  | DataQueryFilterLeaf
  | DataQueryFormulaExpression;
export type DataQueryRelationExistence = { relation: string; quantifier: 'any' | 'none' };
export type DataQueryPredicateV5 =
  | { conjunction: 'and' | 'or'; items: DataQueryPredicateV5[] }
  | { not: DataQueryPredicateV5 }
  | DataQueryFilterLeaf
  | DataQueryFormulaExpression
  | DataQueryRelationExistence;
export type DataQueryExpressionProjection = { expr: DataQueryFormulaExpression; alias: string };
export type DataQueryExpressionNode = DataQueryFormulaExpression | DataQueryFormulaReference;

const name = z
  .string()
  .min(1)
  .refine((v) => !['__proto__', 'prototype', 'constructor'].includes(v));
const formulaAlias = name.refine((value) => value === value.trim() && !/[{}]/.test(value));
export const dataQueryFormulaReferenceSchema: z.ZodType<
  DataQueryFormulaReference,
  DataQueryFormulaReference
> = z.union([
  z
    .object({
      type: z.literal('field'),
      fieldId: z.string().refine((value) => FieldId.create(value).isOk()),
      source: name.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('system'),
      system: z.enum(['id', 'createdTime', 'lastModifiedTime', 'autoNumber', 'version']),
      source: name.optional(),
    })
    .strict(),
  z.object({ type: z.literal('parameter'), name }).strict(),
]);
export const dataQueryFormulaExpressionSchema: z.ZodType<
  DataQueryFormulaExpression,
  DataQueryFormulaExpression
> = z
  .object({
    type: z.literal('formula'),
    formula: z.string().min(1),
    references: z.record(formulaAlias, dataQueryFormulaReferenceSchema),
    timeZone: z.string().min(1).optional(),
  })
  .strict();
export const dataQueryHavingExpressionSchema: z.ZodType<
  DataQueryHavingExpression,
  DataQueryHavingExpression
> = z
  .object({
    type: z.literal('formula'),
    formula: z.string().min(1),
    references: z.record(
      formulaAlias,
      z.union([
        z.object({ type: z.literal('output'), alias: name }).strict(),
        z.object({ type: z.literal('parameter'), name }).strict(),
      ])
    ),
    timeZone: z.string().min(1).optional(),
  })
  .strict();
export const createDataQueryPredicateV3Schema = (
  leaf: z.ZodType<DataQueryFilterLeaf, DataQueryFilterLeaf>
): z.ZodType<DataQueryPredicateV3, DataQueryPredicateV3> => {
  const predicate: z.ZodType<DataQueryPredicateV3, DataQueryPredicateV3> = z.lazy(() =>
    z.union([
      z.object({ conjunction: z.enum(['and', 'or']), items: z.array(predicate).min(1) }).strict(),
      z.object({ not: predicate }).strict(),
      leaf,
      dataQueryFormulaExpressionSchema,
    ])
  );
  return predicate;
};

export const createDataQueryPredicateV5Schema = (
  ordinary: z.ZodType<DataQueryPredicateV3, DataQueryPredicateV3>
): z.ZodType<DataQueryPredicateV5, DataQueryPredicateV5> => {
  const predicate: z.ZodType<DataQueryPredicateV5, DataQueryPredicateV5> = z.lazy(() =>
    z.union([
      z.object({ conjunction: z.enum(['and', 'or']), items: z.array(predicate).min(1) }).strict(),
      z.object({ not: predicate }).strict(),
      z.object({ relation: name, quantifier: z.enum(['any', 'none']) }).strict(),
      ordinary,
    ])
  );
  return predicate;
};

export type DataQueryExpressionVisitor = (node: DataQueryExpressionNode) => void;
export const walkDataQueryFormulaExpression = (
  expression: DataQueryFormulaExpression,
  visit: DataQueryExpressionVisitor
): void => {
  visit(expression);
  for (const reference of Object.values(expression.references)) visit(reference);
};
export const walkDataQueryPredicateExpressions = (
  predicate: DataQueryPredicateV5,
  visit: DataQueryExpressionVisitor
): void => {
  if ('items' in predicate)
    for (const item of predicate.items) walkDataQueryPredicateExpressions(item, visit);
  else if ('not' in predicate) walkDataQueryPredicateExpressions(predicate.not, visit);
  else if ('type' in predicate) walkDataQueryFormulaExpression(predicate, visit);
};
export const collectDataQueryExpressionFields = (
  expression: DataQueryFormulaExpression
): readonly Extract<DataQueryFormulaReference, { type: 'field' }>[] =>
  Object.values(expression.references).filter(
    (reference): reference is Extract<DataQueryFormulaReference, { type: 'field' }> =>
      reference.type === 'field'
  );
export const collectDataQueryExpressionParameters = (
  expression: DataQueryFormulaExpression
): readonly string[] => [
  ...new Set(
    Object.values(expression.references)
      .filter((reference) => reference.type === 'parameter')
      .map((reference) => reference.name)
  ),
];

export const mapDataQueryFormulaExpression = (
  expression: DataQueryFormulaExpression,
  mapper: (node: DataQueryExpressionNode) => DataQueryExpressionNode
): DataQueryFormulaExpression => {
  const references: Record<string, DataQueryFormulaReference> = Object.create(null);
  for (const [alias, reference] of Object.entries(expression.references)) {
    const mapped = mapper(reference);
    if (mapped.type === 'formula')
      throw new Error('Formula references must remain field, system, or parameter references');
    references[alias] = mapped;
  }
  const mapped = mapper({ ...expression, references });
  if (mapped.type !== 'formula') throw new Error('Formula expressions must remain formulas');
  return mapped;
};
export const mapDataQueryPredicateV3 = (
  predicate: DataQueryPredicateV3,
  mapper: (node: DataQueryExpressionNode) => DataQueryExpressionNode
): DataQueryPredicateV3 => {
  if ('items' in predicate)
    return {
      ...predicate,
      items: predicate.items.map((item) => mapDataQueryPredicateV3(item, mapper)),
    };
  if ('not' in predicate) return { not: mapDataQueryPredicateV3(predicate.not, mapper) };
  return 'type' in predicate ? mapDataQueryFormulaExpression(predicate, mapper) : predicate;
};
