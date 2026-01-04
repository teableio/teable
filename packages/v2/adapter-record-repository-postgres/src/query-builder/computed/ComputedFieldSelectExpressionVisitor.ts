import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type CreatedByField,
  type CreatedTimeField,
  FieldType,
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
  type Table,
  type UserField,
} from '@teable/v2-core';
import {
  FormulaSqlPgTranslator,
  guardValueSql,
  makeExpr,
  type SqlExpr,
} from '@teable/v2-formula-sql-pg';
import { sql, type AliasedRawBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { FieldOutputColumnVisitor } from '../FieldOutputColumnVisitor';

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
export type LinkOrderBy =
  | { source: 'foreign'; column: string }
  | {
      source: 'junction';
      column: string;
      junctionTable: string;
      selfKey: string;
      foreignKey: string;
    };

export type LateralColumnType =
  | { type: 'link'; lookupFieldId: FieldId; isMultiValue: boolean; orderBy?: LinkOrderBy }
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

export class ComputedFieldSelectExpressionVisitor
  implements IFieldVisitor<AliasedRawBuilder<unknown, string>>
{
  private readonly columnVisitor = new FieldOutputColumnVisitor();
  private readonly formulaTranslator: FormulaSqlPgTranslator;

  constructor(
    private readonly table: Table,
    private readonly tableAlias: string,
    private readonly lateral: ILateralContext
  ) {
    this.formulaTranslator = new FormulaSqlPgTranslator({
      table,
      tableAlias,
      resolveFieldSql: (field) => this.resolveFieldReferenceSql(field),
    });
  }

  // Helper to get column alias from field using the shared visitor
  private getColAlias(field: Field): Result<string, DomainError> {
    return this.columnVisitor.getColumnAlias(field);
  }

  private quoteIdentifier(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private qualify(alias: string, column: string): string {
    return `${this.quoteIdentifier(alias)}.${this.quoteIdentifier(column)}`;
  }

  private resolveFieldReferenceSql(field: Field): Result<SqlExpr, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      if (field.type().equals(FieldType.link())) {
        const linkField = field as LinkField;
        const isMultiValue = linkField.relationship().isMultipleValue();
        const orderByResult = this.getLinkOrderBy(linkField);
        if (orderByResult.isErr()) return err(orderByResult.error);
        const lateralAlias = this.lateral.addColumn(
          linkField.id(),
          linkField.foreignTableId().toString(),
          colAlias,
          {
            type: 'link',
            lookupFieldId: linkField.lookupFieldId(),
            isMultiValue,
            orderBy: orderByResult.value,
          }
        );
        return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
      }

      if (field.type().equals(FieldType.lookup())) {
        const lookupField = field as LookupField;
        const lateralAlias = this.lateral.addColumn(
          lookupField.linkFieldId(),
          lookupField.foreignTableId().toString(),
          colAlias,
          {
            type: 'lookup',
            foreignFieldId: lookupField.lookupFieldId(),
          }
        );
        return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
      }

      if (field.type().equals(FieldType.rollup())) {
        const rollupField = field as RollupField;
        const aggregate = rollupExpressionToSqlAggregate(rollupField.expression().toString());
        const lateralAlias = this.lateral.addColumn(
          rollupField.linkFieldId(),
          rollupField.foreignTableId().toString(),
          colAlias,
          {
            type: 'rollup',
            foreignFieldId: rollupField.lookupFieldId(),
            aggregate,
          }
        );
        return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
      }

      return ok(makeExpr(this.qualify(this.tableAlias, colAlias), 'unknown', false));
    });
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
    return this.getColAlias(field).andThen((colAlias) => {
      const translated = this.formulaTranslator.translateExpression(field.expression().toString());
      if (translated.isErr()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      const expr = translated.value;
      const typedSql = guardValueSql(expr.valueSql, expr.errorConditionSql);
      return ok(sql.raw(typedSql).as(colAlias));
    });
  }

  // Link-based fields - need lateral join
  visitLinkField(field: LinkField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      const isMultiValue = field.relationship().isMultipleValue();
      const orderByResult = this.getLinkOrderBy(field);
      if (orderByResult.isErr()) return err(orderByResult.error);
      const lateralAlias = this.lateral.addColumn(
        field.id(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'link',
          lookupFieldId: field.lookupFieldId(),
          isMultiValue,
          orderBy: orderByResult.value,
        }
      );
      return ok(sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias));
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

  private getLinkOrderBy(field: LinkField): Result<LinkOrderBy | undefined, DomainError> {
    if (!field.relationship().isMultipleValue()) return ok(undefined);
    if (!field.hasOrderColumn()) return ok(undefined);

    const orderColumnResult = field.orderColumnName();
    if (orderColumnResult.isErr()) return err(orderColumnResult.error);
    const orderColumn = orderColumnResult.value;

    const relationship = field.relationship().toString();
    if (relationship === 'manyMany') {
      return field.fkHostTableNameString().andThen((junctionTable) =>
        field.selfKeyNameString().andThen((selfKey) =>
          field.foreignKeyNameString().map(
            (foreignKey): LinkOrderBy => ({
              source: 'junction',
              column: orderColumn,
              junctionTable,
              selfKey,
              foreignKey,
            })
          )
        )
      );
    }

    return ok({ source: 'foreign', column: orderColumn });
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
