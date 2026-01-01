import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type Field,
  type FieldId,
  type FormulaField,
  type IFieldVisitor,
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
import { sql, type AliasedRawBuilder } from 'kysely';
import type { Result } from 'neverthrow';

import { FieldOutputColumnVisitor } from './FieldOutputColumnVisitor';

/** SQL aggregate functions for rollup */
export const SqlAggregate = {
  COUNT: 'COUNT',
  SUM: 'SUM',
  AVG: 'AVG',
  MAX: 'MAX',
  MIN: 'MIN',
  BOOL_AND: 'BOOL_AND',
  BOOL_OR: 'BOOL_OR',
  BOOL_XOR: 'BOOL_XOR',
  STRING_AGG: 'STRING_AGG',
  ARRAY_AGG: 'ARRAY_AGG',
} as const;

export type SqlAggregate = (typeof SqlAggregate)[keyof typeof SqlAggregate];

/** Column type for lateral join */
export type LateralColumnType =
  | { type: 'link'; lookupFieldId: FieldId; isMultiValue: boolean }
  | { type: 'lookup'; foreignFieldId: FieldId }
  | { type: 'rollup'; foreignFieldId: FieldId; aggregate: SqlAggregate };

/** Shared context for collecting lateral join requirements */
export interface ILateralContext {
  /** Add a column to lateral join, returns the lateral alias */
  addColumn(
    linkFieldId: FieldId,
    foreignTableId: string,
    outputAlias: string,
    columnType: LateralColumnType
  ): string;
}

export class FieldSelectExpressionVisitor
  implements IFieldVisitor<AliasedRawBuilder<unknown, string>>
{
  private readonly columnVisitor = new FieldOutputColumnVisitor();

  constructor(
    private readonly tableAlias: string,
    private readonly lateral: ILateralContext
  ) {}

  // Helper to get column alias from field using the shared visitor
  private getColAlias(field: Field): Result<string, DomainError> {
    return this.columnVisitor.getColumnAlias(field);
  }

  // Simple column fields - just select from main table
  private simpleColumn(field: Field): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) =>
      sql`${sql.ref(`${this.tableAlias}.${colAlias}`)}`.as(colAlias)
    );
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitNumberField(field: NumberField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitDateField(field: DateField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitUserField(field: UserField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitCreatedTimeField(
    field: CreatedTimeField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitRatingField(field: RatingField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitButtonField(field: ButtonField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  // Formula - TODO: convert to SQL
  visitFormulaField(field: FormulaField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => sql`NULL`.as(colAlias));
  }

  // Link-based fields - need lateral join
  visitLinkField(field: LinkField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const isMultiValue = field.relationship().isMultipleValue();
      const lateralAlias = this.lateral.addColumn(
        field.id(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'link',
          lookupFieldId: field.lookupFieldId(),
          isMultiValue,
        }
      );
      return sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
    });
  }

  visitLookupField(field: LookupField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'lookup',
          foreignFieldId: field.lookupFieldId(),
        }
      );
      return sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
    });
  }

  visitRollupField(field: RollupField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const aggregate = rollupExpressionToSqlAggregate(field.expression().toString());
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'rollup',
          foreignFieldId: field.lookupFieldId(),
          aggregate,
        }
      );
      return sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
    });
  }
}

/** Map RollupExpression to SQL aggregate function */
function rollupExpressionToSqlAggregate(expr: string): SqlAggregate {
  const mapping: Record<string, SqlAggregate> = {
    'countall({values})': SqlAggregate.COUNT,
    'counta({values})': SqlAggregate.COUNT,
    'count({values})': SqlAggregate.COUNT,
    'sum({values})': SqlAggregate.SUM,
    'average({values})': SqlAggregate.AVG,
    'max({values})': SqlAggregate.MAX,
    'min({values})': SqlAggregate.MIN,
    'and({values})': SqlAggregate.BOOL_AND,
    'or({values})': SqlAggregate.BOOL_OR,
    'xor({values})': SqlAggregate.BOOL_XOR,
    'array_join({values})': SqlAggregate.STRING_AGG,
    'array_unique({values})': SqlAggregate.ARRAY_AGG,
    'array_compact({values})': SqlAggregate.ARRAY_AGG,
    'concatenate({values})': SqlAggregate.STRING_AGG,
  };
  return mapping[expr] ?? SqlAggregate.ARRAY_AGG;
}
