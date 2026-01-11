import {
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
  type FieldCondition,
  type FieldId,
  FieldType,
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
  type RollupFunction,
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
  | {
      type: 'rollup';
      foreignFieldId: FieldId;
      expression: RollupFunction;
      orderBy?: LinkOrderBy;
    }
  | { type: 'conditionalLookup'; foreignFieldId: FieldId; condition: FieldCondition }
  | {
      type: 'conditionalRollup';
      foreignFieldId: FieldId;
      expression: RollupFunction;
      condition: FieldCondition;
    };

/** Shared context for collecting lateral join requirements */
export interface ILateralContext {
  /** Add a column to lateral join, returns the lateral alias */
  addColumn(
    linkFieldId: FieldId,
    foreignTableId: string,
    outputAlias: string,
    columnType: LateralColumnType
  ): string;

  /**
   * Add a conditional field that uses a scalar subquery instead of a lateral join.
   * Unlike link-based fields, conditional fields don't have a linkFieldId - they use
   * their own fieldId as the key and apply a condition filter on the foreign table.
   */
  addConditionalColumn(
    conditionalFieldId: FieldId,
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
      resolveFieldSql: (field: Field) => this.resolveFieldReferenceSql(field),
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
        const expression = rollupField.expression().toString();
        const linkFieldResult = rollupField
          .linkField(this.table)
          .andThen((linkField) => this.getLinkOrderBy(linkField));
        if (linkFieldResult.isErr()) return err(linkFieldResult.error);
        const lateralAlias = this.lateral.addColumn(
          rollupField.linkFieldId(),
          rollupField.foreignTableId().toString(),
          colAlias,
          {
            type: 'rollup',
            foreignFieldId: rollupField.lookupFieldId(),
            expression,
            orderBy: linkFieldResult.value,
          }
        );
        return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
      }

      if (field.type().equals(FieldType.conditionalLookup())) {
        const conditionalLookupField = field as ConditionalLookupField;
        const options = conditionalLookupField.conditionalLookupOptions();
        const lateralAlias = this.lateral.addConditionalColumn(
          conditionalLookupField.id(),
          options.foreignTableId().toString(),
          colAlias,
          {
            type: 'conditionalLookup',
            foreignFieldId: options.lookupFieldId(),
            condition: options.condition(),
          }
        );
        return ok(makeExpr(this.qualify(lateralAlias, colAlias), 'unknown', false));
      }

      if (field.type().equals(FieldType.conditionalRollup())) {
        const conditionalRollupField = field as ConditionalRollupField;
        const config = conditionalRollupField.config();
        const expression = conditionalRollupField.expression().toString();
        const lateralAlias = this.lateral.addConditionalColumn(
          conditionalRollupField.id(),
          config.foreignTableId().toString(),
          colAlias,
          {
            type: 'conditionalRollup',
            foreignFieldId: config.lookupFieldId(),
            expression,
            condition: config.condition(),
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
    return this.getColAlias(field).andThen((colAlias) => {
      const expression = field.expression().toString();
      const orderByResult = field
        .linkField(this.table)
        .andThen((linkField) => this.getLinkOrderBy(linkField));
      if (orderByResult.isErr()) return err(orderByResult.error);
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'rollup',
          foreignFieldId: field.lookupFieldId(),
          expression,
          orderBy: orderByResult.value,
        }
      );
      return ok(sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias));
    });
  }

  /**
   * ConditionalRollup field - aggregates values from foreign table based on conditions.
   *
   * Unlike regular rollup fields that follow a link relationship, conditional rollup
   * uses a condition filter to select which foreign records to aggregate.
   * The actual SQL generation happens in ComputedTableRecordQueryBuilder.buildConditionalSubquery.
   */
  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const config = field.config();
      const expression = field.expression().toString();
      const lateralAlias = this.lateral.addConditionalColumn(
        field.id(),
        config.foreignTableId().toString(),
        colAlias,
        {
          type: 'conditionalRollup',
          foreignFieldId: config.lookupFieldId(),
          expression,
          condition: config.condition(),
        }
      );
      return sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias);
    });
  }

  /**
   * ConditionalLookup field - looks up values from foreign table based on conditions.
   *
   * Unlike regular lookup fields that follow a link relationship, conditional lookup
   * uses a condition filter to select which foreign records to include.
   * The actual SQL generation happens in ComputedTableRecordQueryBuilder.buildConditionalSubquery.
   */
  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const options = field.conditionalLookupOptions();
      const lateralAlias = this.lateral.addConditionalColumn(
        field.id(),
        options.foreignTableId().toString(),
        colAlias,
        {
          type: 'conditionalLookup',
          foreignFieldId: options.lookupFieldId(),
          condition: options.condition(),
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
    const usesJunction =
      relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay());
    if (usesJunction) {
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
