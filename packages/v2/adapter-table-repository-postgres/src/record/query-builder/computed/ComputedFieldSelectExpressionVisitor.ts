import {
  FieldType,
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
  extractJsonScalarText,
  normalizeToJsonArrayWithStrategy,
  FormulaSqlPgTranslator,
  guardValueSql,
  type IPgTypeValidationStrategy,
  type SqlExpr,
  type SqlValueType,
} from '@teable/v2-formula-sql-pg';
import { sql, type AliasedRawBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { FieldSqlLiteralVisitor } from '../../visitors/FieldSqlLiteralVisitor';
import { FieldOutputColumnVisitor } from '../FieldOutputColumnVisitor';
import { FieldReferenceSqlVisitor } from './FieldReferenceSqlVisitor';

/** Column type for lateral join */
export type LinkOrderBy =
  | { source: 'foreign'; column?: string }
  | {
      source: 'junction';
      column?: string;
      junctionTable: string;
      selfKey: string;
      foreignKey: string;
    };

export type LateralColumnType =
  | { type: 'link'; lookupFieldId: FieldId; isMultiValue: boolean; orderBy?: LinkOrderBy }
  | {
      type: 'lookup';
      foreignFieldId: FieldId;
      isMultiValue: boolean;
      orderBy?: LinkOrderBy;
      condition?: FieldCondition;
    }
  | {
      type: 'rollup';
      foreignFieldId: FieldId;
      expression: RollupFunction;
      orderBy?: LinkOrderBy;
    }
  | {
      type: 'conditionalLookup';
      foreignFieldId: FieldId;
      condition: FieldCondition;
      isMultiValue: boolean;
    }
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

export interface ComputedFieldSelectExpressionVisitorOptions {
  /**
   * Use stored formula values for non-deterministic formulas like
   * LAST_MODIFIED_TIME({fieldA}, {fieldB}).
   */
  preferStoredLastModifiedFormula?: boolean;
  /**
   * Foreign table IDs that are missing (e.g., deleted) and should be skipped.
   */
  missingForeignTableIds?: ReadonlySet<string>;
}

export class ComputedFieldSelectExpressionVisitor
  implements IFieldVisitor<AliasedRawBuilder<unknown, string>>
{
  private readonly columnVisitor = new FieldOutputColumnVisitor();
  private readonly fieldReferenceVisitor: FieldReferenceSqlVisitor;
  private readonly preferStoredLastModifiedFormula: boolean;
  private readonly missingForeignTableIds: ReadonlySet<string>;

  constructor(
    private readonly table: Table,
    private readonly tableAlias: string,
    private readonly lateral: ILateralContext,
    private readonly typeValidationStrategy: IPgTypeValidationStrategy,
    options?: ComputedFieldSelectExpressionVisitorOptions
  ) {
    this.preferStoredLastModifiedFormula = options?.preferStoredLastModifiedFormula ?? false;
    this.missingForeignTableIds = options?.missingForeignTableIds ?? new Set();
    this.fieldReferenceVisitor = new FieldReferenceSqlVisitor({
      table,
      tableAlias,
      lateral,
      missingForeignTableIds: this.missingForeignTableIds,
    });
  }

  private isMissingForeignTableId(tableId: string): boolean {
    return this.missingForeignTableIds.has(tableId);
  }

  private nullColumn(
    field: Field,
    colAlias: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return field
      .accept(FieldSqlLiteralVisitor.create(null))
      .map((literal) => sql.raw(literal).as(colAlias));
  }

  private createFormulaTranslator(timeZone?: string): FormulaSqlPgTranslator {
    return new FormulaSqlPgTranslator({
      table: this.table,
      tableAlias: this.tableAlias,
      resolveFieldSql: (field: Field) => this.resolveFieldReferenceSql(field),
      typeValidationStrategy: this.typeValidationStrategy,
      timeZone,
    });
  }

  // Helper to get column alias from field using the shared visitor
  private getColAlias(field: Field): Result<string, DomainError> {
    return this.columnVisitor.getColumnAlias(field);
  }

  /**
   * Resolve field reference to SQL expression using the visitor pattern.
   * This delegates to FieldReferenceSqlVisitor which handles all field types.
   */
  private resolveFieldReferenceSql(field: Field): Result<SqlExpr, DomainError> {
    return field.accept(this.fieldReferenceVisitor);
  }

  // Simple column fields - just select from main table
  private simpleColumn(field: Field): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) =>
      sql`${sql.ref(`${this.tableAlias}.${colAlias}`)}`.as(colAlias)
    );
  }

  private userColumn(field: Field): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const colRef = sql.ref(`${this.tableAlias}.${colAlias}`);
      const colJson = sql`to_jsonb(${colRef})`;
      const normalizedColJson = sql`(CASE
        WHEN ${colRef} IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(${colJson}) = 'array' THEN ${colJson}
        ELSE '[]'::jsonb
      END)`;
      const avatarPrefix = '/api/attachments/read/public/avatar/';

      const userFromId = (idExpr: ReturnType<typeof sql>) => sql`(
        select jsonb_build_object(
          'id', u.id,
          'title', u.name,
          'email', u.email,
          'avatarUrl', ${avatarPrefix} || u.id
        )
        from public.users u
        where u.id = ${idExpr}
      )`;

      const idFromJson = (jsonExpr: ReturnType<typeof sql>) =>
        sql`coalesce(${jsonExpr} ->> 'id', ${jsonExpr} #>> '{}')`;

      const arrayExpr = sql`(
        select coalesce(
          jsonb_agg(coalesce(${userFromId(idFromJson(sql`elem`))}, elem)),
          '[]'::jsonb
        )
        from jsonb_array_elements(${normalizedColJson}) as elem
      )`;

      const singleExpr = sql`coalesce(${userFromId(idFromJson(colJson))}, ${colJson})`;

      return sql`
        case
          when ${colRef} is null then null
          when jsonb_typeof(${colJson}) = 'array' then ${arrayExpr}
          else ${singleExpr}
        end
      `.as(colAlias);
    });
  }

  /**
   * Generates SELECT expression for CreatedBy/LastModifiedBy fields.
   * These fields read from system columns (__created_by / __last_modified_by) which store user IDs,
   * then join the users table to populate complete user objects (id, title, email, avatarUrl).
   */
  private systemUserColumn(
    field: Field,
    systemColumn: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const systemColRef = sql.ref(`${this.tableAlias}.${systemColumn}`);
      const avatarPrefix = '/api/attachments/read/public/avatar/';

      // Build user object from system column's user ID
      const userExpr = sql`(
        select jsonb_build_object(
          'id', u.id,
          'title', u.name,
          'email', u.email,
          'avatarUrl', ${avatarPrefix} || u.id
        )
        from public.users u
        where u.id = ${systemColRef}
      )`;

      return sql`${userExpr}`.as(colAlias);
    });
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
    return this.userColumn(field);
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
    return this.systemUserColumn(field, '__created_by');
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.systemUserColumn(field, '__last_modified_by');
  }

  visitRatingField(field: RatingField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitButtonField(field: ButtonField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitFormulaField(field: FormulaField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      // Skip computation if field has error - return NULL
      if (field.hasError().isError()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      if (this.shouldUseStoredFormula(field)) {
        return ok(sql`${sql.ref(`${this.tableAlias}.${colAlias}`)}`.as(colAlias));
      }
      const translator = this.createFormulaTranslator(field.timeZone()?.toString());
      const translated = translator.translateExpression(field.expression().toString());
      if (translated.isErr()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      const expr = translated.value;

      const isMultipleResult = field
        .isMultipleCellValue()
        .map((multiplicity) => multiplicity.isMultiple());
      if (isMultipleResult.isErr()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      const formulaIsMultiple = isMultipleResult.value;

      // Note: Formula fields can be scalar or array (jsonb) depending on their inferred result type.
      // Only unwrap arrays when the formula field itself is scalar.
      let finalValueSql: string;

      if (expr.storageKind === 'json' && this.shouldExtractJsonDisplay(expr)) {
        // When formula directly references a structured JSON field (e.g., link/button),
        // extract display values (title/name) rather than returning the full object.
        finalValueSql =
          formulaIsMultiple || expr.isArray
            ? this.extractJsonArrayToTextJsonb(expr.valueSql)
            : extractJsonScalarText(`(${expr.valueSql})::jsonb`);
      } else if (expr.isArray && !formulaIsMultiple) {
        finalValueSql = this.unwrapFormulaArrayToScalar(expr.valueSql, expr.valueType);
      } else {
        finalValueSql = expr.valueSql;
      }

      const typedSql = guardValueSql(finalValueSql, expr.errorConditionSql);
      return ok(sql.raw(typedSql).as(colAlias));
    });
  }

  private shouldUseStoredFormula(field: FormulaField): boolean {
    if (!this.preferStoredLastModifiedFormula) return false;
    const hasParams = field.expression().hasLastModifiedTimeParams();
    return hasParams.isOk() && hasParams.value;
  }

  /**
   * Unwrap a jsonb array formula result to a scalar value.
   * Extracts the first element and casts to the appropriate type.
   */
  private unwrapFormulaArrayToScalar(valueSql: string, valueType: SqlValueType): string {
    // Extract first element from jsonb array
    const firstElemText = `(((${valueSql}) ->> 0))`;

    switch (valueType) {
      case 'number':
        // Cast to numeric, handle empty string as NULL
        return `NULLIF(${firstElemText}, '')::double precision`;
      case 'boolean':
        return `(${firstElemText})::boolean`;
      case 'datetime':
        return `(${firstElemText})::timestamptz`;
      case 'string':
      default:
        return firstElemText;
    }
  }

  private shouldExtractJsonDisplay(expr: SqlExpr): boolean {
    const referenced = expr.field;
    if (!referenced) return false;

    const type = referenced.type();
    return (
      type.equals(FieldType.link()) ||
      type.equals(FieldType.button()) ||
      type.equals(FieldType.user())
    );
  }

  private extractJsonArrayToTextJsonb(valueSql: string): string {
    const normalized = normalizeToJsonArrayWithStrategy(valueSql, this.typeValidationStrategy);
    return `(
      SELECT jsonb_agg(to_jsonb(${extractJsonScalarText('elem')}) ORDER BY ord)
      FROM jsonb_array_elements(${normalized}) WITH ORDINALITY AS _jae(elem, ord)
    )`;
  }

  // Link-based fields - need lateral join
  visitLinkField(field: LinkField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      if (this.isMissingForeignTableId(field.foreignTableId().toString())) {
        return this.nullColumn(field, colAlias);
      }
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
    return this.getColAlias(field).andThen((colAlias) => {
      if (this.isMissingForeignTableId(field.foreignTableId().toString())) {
        return ok(sql.raw('NULL::jsonb').as(colAlias));
      }
      // Skip computation if field has error - return NULL
      if (field.hasError().isError()) {
        return ok(sql.raw('NULL::jsonb').as(colAlias));
      }
      const linkFieldResult = field.linkField(this.table);
      if (linkFieldResult.isErr()) return err(linkFieldResult.error);
      const linkField = linkFieldResult.value;
      const multiplicityResult = field
        .isMultipleCellValue()
        .map((multiplicity) => multiplicity.isMultiple());
      if (multiplicityResult.isErr()) return err(multiplicityResult.error);
      const isMultiValue = multiplicityResult.value;
      const orderByResult = this.getLinkOrderBy(linkField);
      if (orderByResult.isErr()) return err(orderByResult.error);
      const condition = field.lookupOptions().condition();
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'lookup',
          foreignFieldId: field.lookupFieldId(),
          isMultiValue,
          orderBy: orderByResult.value,
          condition,
        }
      );
      return ok(sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias));
    });
  }

  visitRollupField(field: RollupField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).andThen((colAlias) => {
      if (this.isMissingForeignTableId(field.foreignTableId().toString())) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      // Skip computation if field has error - return NULL
      if (field.hasError().isError()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
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
    return this.getColAlias(field).andThen((colAlias) => {
      const config = field.config();
      if (this.isMissingForeignTableId(config.foreignTableId().toString())) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      // Skip computation if field has error - return NULL
      if (field.hasError().isError()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
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
      return ok(sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias));
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
    return this.getColAlias(field).andThen((colAlias) =>
      field.isMultipleCellValue().andThen((multiplicity) => {
        // Skip computation if field has error - return NULL
        const options = field.conditionalLookupOptions();
        if (this.isMissingForeignTableId(options.foreignTableId().toString())) {
          return ok(sql.raw('NULL::jsonb').as(colAlias));
        }
        if (field.hasError().isError()) {
          return ok(sql.raw('NULL::jsonb').as(colAlias));
        }
        const lateralAlias = this.lateral.addConditionalColumn(
          field.id(),
          options.foreignTableId().toString(),
          colAlias,
          {
            type: 'conditionalLookup',
            foreignFieldId: options.lookupFieldId(),
            condition: options.condition(),
            isMultiValue: multiplicity.isMultiple(),
          }
        );
        return ok(sql`${sql.ref(`${lateralAlias}.${colAlias}`)}`.as(colAlias));
      })
    );
  }

  private getLinkOrderBy(field: LinkField): Result<LinkOrderBy | undefined, DomainError> {
    // For single-value relationships, ordering doesn't matter
    if (!field.relationship().isMultipleValue()) return ok(undefined);

    const relationship = field.relationship().toString();
    const usesJunction =
      relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay());

    // For junction-based relationships (manyMany, oneMany one-way)
    if (usesJunction) {
      return field.fkHostTableNameString().andThen((junctionTable) =>
        field.selfKeyNameString().andThen((selfKey) =>
          field.foreignKeyNameString().andThen((foreignKey) => {
            // Get order column if it exists
            if (field.hasOrderColumn()) {
              const orderColumnResult = field.orderColumnName();
              if (orderColumnResult.isErr()) return err(orderColumnResult.error);
              return ok({
                source: 'junction' as const,
                column: orderColumnResult.value,
                junctionTable,
                selfKey,
                foreignKey,
              });
            }
            // No order column - return LinkOrderBy without column to trigger default ordering
            return ok({
              source: 'junction' as const,
              column: undefined,
              junctionTable,
              selfKey,
              foreignKey,
            });
          })
        )
      );
    }

    // For foreign-based relationships (oneMany two-way)
    if (field.hasOrderColumn()) {
      const orderColumnResult = field.orderColumnName();
      if (orderColumnResult.isErr()) return err(orderColumnResult.error);
      return ok({ source: 'foreign' as const, column: orderColumnResult.value });
    }

    // No order column - return LinkOrderBy without column to trigger default ordering
    return ok({ source: 'foreign' as const, column: undefined });
  }
}
