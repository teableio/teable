import type { CellValueMultiplicity, CellValueType, Field } from '@teable/v2-core';
import type { DataQueryFilter, DataQuerySystemField } from './types';

export type BoundDataQueryExpressionType = {
  readonly valueType: CellValueType;
  readonly multiplicity: CellValueMultiplicity;
  readonly nullable: boolean;
  readonly field?: Field;
};
export type BoundDataQueryReferenceExpression = BoundDataQueryExpressionType &
  (
    | { readonly kind: 'field'; readonly source: string; readonly fieldId: string }
    | { readonly kind: 'system'; readonly source: string; readonly system: DataQuerySystemField }
    | { readonly kind: 'parameter'; readonly name: string }
  );
export type BoundDataQueryFormulaExpression = BoundDataQueryExpressionType & {
  readonly kind: 'formula';
  readonly formula: string;
  readonly references: Readonly<Record<string, BoundDataQueryReferenceExpression>>;
  readonly timeZone?: string;
  /** Source row used by implicit record functions, independent of reference inputs. */
  readonly recordSource: string;
};
export type BoundDataQueryHavingReference = BoundDataQueryExpressionType &
  (
    | { readonly kind: 'output'; readonly alias: string }
    | { readonly kind: 'parameter'; readonly name: string }
  );
export type BoundDataQueryHavingExpression = BoundDataQueryExpressionType & {
  readonly kind: 'formula';
  readonly formula: string;
  readonly references: Readonly<Record<string, BoundDataQueryHavingReference>>;
  readonly timeZone?: string;
};
export type BoundDataQueryPredicate =
  | {
      readonly kind: 'group';
      readonly conjunction: 'and' | 'or';
      readonly items: readonly BoundDataQueryPredicate[];
    }
  | { readonly kind: 'not'; readonly predicate: BoundDataQueryPredicate }
  | { readonly kind: 'exists'; readonly relation: string; readonly quantifier: 'any' | 'none' }
  | { readonly kind: 'legacy'; readonly source: string; readonly filter: DataQueryFilter }
  | { readonly kind: 'formula'; readonly expression: BoundDataQueryFormulaExpression };
