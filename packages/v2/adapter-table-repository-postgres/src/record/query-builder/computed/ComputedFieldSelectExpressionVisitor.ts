import { inspectFormulaStructure } from '@teable/formula';
import {
  FieldType,
  FieldValueTypeVisitor,
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
  FormulaSqlPgTranslator,
  FormulaCompileBudget,
  defaultFormulaCompileBudgetConfig,
  resolveFormulaCompileBudget,
  type FormulaCompileBudgetConfig,
  isFormulaCompileBudgetError,
  finalizeFormulaOutputSql,
  type IPgTypeValidationStrategy,
  type SqlExpr,
} from '@teable/v2-formula-sql-pg';
import { sql, type AliasedRawBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { FieldSqlLiteralVisitor } from '../../visitors/FieldSqlLiteralVisitor';
import { FieldOutputColumnVisitor } from '../FieldOutputColumnVisitor';
import {
  buildUserJsonObjectFromSnapshotExpr,
  buildUserJsonObjectFromSnapshotWithLookupExpr,
  type UserSnapshotActorFallback,
} from '../userSnapshotSql';
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
      isUnique?: boolean;
      orderBy?: LinkOrderBy;
      condition?: FieldCondition;
    }
  | {
      type: 'rollup';
      foreignFieldId: FieldId;
      expression: RollupFunction;
      orderBy?: LinkOrderBy;
      condition?: FieldCondition;
    }
  | {
      type: 'conditionalLookup';
      foreignFieldId: FieldId;
      condition: FieldCondition;
      isMultiValue: boolean;
      isUnique?: boolean;
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

const normalizeComputedNullCastType = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case 'JSON':
      return 'jsonb';
    case 'REAL':
      return 'double precision';
    case 'DATETIME':
      return 'timestamptz';
    case 'BOOLEAN':
      return 'boolean';
    case 'TEXT':
      return 'text';
    default:
      return normalized.toLowerCase();
  }
};

export interface ComputedFieldSelectExpressionVisitorOptions {
  formulaCompileBudget?: FormulaCompileBudgetConfig;
  /**
   * Use stored formula values for non-deterministic formulas like
   * LAST_MODIFIED_TIME({fieldA}, {fieldB}).
   */
  preferStoredLastModifiedFormula?: boolean;
  /**
   * Foreign table IDs that are missing (e.g., deleted) and should be skipped.
   */
  missingForeignTableIds?: ReadonlySet<string>;
  erroredLookupReferenceMode?: 'stored' | 'error';
  forceLookupArrayOutput?: boolean;
  userSnapshotActorFallback?: UserSnapshotActorFallback;
  resolveSystemUserSnapshotsFromUsers?: boolean;
}

export class ComputedFieldSelectExpressionVisitor implements IFieldVisitor<
  AliasedRawBuilder<unknown, string>
> {
  private readonly columnVisitor = new FieldOutputColumnVisitor();
  private readonly fieldReferenceVisitor: FieldReferenceSqlVisitor;
  private readonly preferStoredLastModifiedFormula: boolean;
  private readonly missingForeignTableIds: ReadonlySet<string>;
  private readonly erroredLookupReferenceMode: 'stored' | 'error';
  private readonly forceLookupArrayOutput: boolean;
  private readonly userSnapshotActorFallback?: UserSnapshotActorFallback;
  private readonly resolveSystemUserSnapshotsFromUsers: boolean;
  private readonly formulaCompileBudget: FormulaCompileBudgetConfig;

  constructor(
    private readonly table: Table,
    private readonly tableAlias: string,
    private readonly lateral: ILateralContext,
    private readonly typeValidationStrategy: IPgTypeValidationStrategy,
    options?: ComputedFieldSelectExpressionVisitorOptions
  ) {
    this.formulaCompileBudget = options?.formulaCompileBudget ?? defaultFormulaCompileBudgetConfig;
    this.preferStoredLastModifiedFormula = options?.preferStoredLastModifiedFormula ?? false;
    this.missingForeignTableIds = options?.missingForeignTableIds ?? new Set();
    this.erroredLookupReferenceMode = options?.erroredLookupReferenceMode ?? 'stored';
    this.forceLookupArrayOutput = options?.forceLookupArrayOutput ?? true;
    this.userSnapshotActorFallback = options?.userSnapshotActorFallback;
    this.resolveSystemUserSnapshotsFromUsers =
      options?.resolveSystemUserSnapshotsFromUsers ?? false;
    this.fieldReferenceVisitor = new FieldReferenceSqlVisitor({
      table,
      tableAlias,
      lateral,
      missingForeignTableIds: this.missingForeignTableIds,
      erroredLookupReferenceMode: this.erroredLookupReferenceMode,
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

  private typedNullColumn(
    field: Field,
    colAlias: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    const dbFieldTypeResult = field.dbFieldType().andThen((dbFieldType) => dbFieldType.value());

    if (dbFieldTypeResult.isOk()) {
      const castType = normalizeComputedNullCastType(dbFieldTypeResult.value);
      return ok(sql.raw(`NULL::${castType}`).as(colAlias));
    }

    return field
      .isMultipleCellValue()
      .map((multiplicity) => multiplicity.isMultiple())
      .map((isMultiple) => sql.raw(isMultiple ? 'NULL::jsonb' : 'NULL').as(colAlias))
      .orElse(() => this.nullColumn(field, colAlias));
  }

  private createFormulaTranslator(
    budget: FormulaCompileBudget,
    timeZone?: string
  ): FormulaSqlPgTranslator {
    return new FormulaSqlPgTranslator({
      table: this.table,
      budget,
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

  private systemScalarColumn(
    field: Field,
    systemColumn: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) =>
      sql`${sql.ref(`${this.tableAlias}.${systemColumn}`)}`.as(colAlias)
    );
  }

  private userColumn(field: Field): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  private systemUserColumn(
    field: Field,
    systemColumn?: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.getColAlias(field).map((colAlias) => {
      const snapshotRef = sql.ref(`${this.tableAlias}.${colAlias}`);
      const systemColRef = systemColumn ? sql.ref(`${this.tableAlias}.${systemColumn}`) : undefined;
      const valueExpr =
        this.resolveSystemUserSnapshotsFromUsers && systemColRef
          ? buildUserJsonObjectFromSnapshotWithLookupExpr(snapshotRef, systemColRef)
          : buildUserJsonObjectFromSnapshotExpr(
              snapshotRef,
              systemColRef,
              this.userSnapshotActorFallback
            );
      return sql`${valueExpr}`.as(colAlias);
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
    return this.systemScalarColumn(field, '__created_time');
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .andThen((generated) =>
        generated
          ? this.systemScalarColumn(field, '__last_modified_time')
          : this.simpleColumn(field)
      );
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.systemScalarColumn(field, '__auto_number');
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.systemUserColumn(field, '__created_by');
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    if (this.resolveSystemUserSnapshotsFromUsers) {
      return this.systemUserColumn(field, '__last_modified_by');
    }

    return field.isTrackAll()
      ? this.systemUserColumn(field, '__last_modified_by')
      : this.systemUserColumn(field);
  }

  visitRatingField(field: RatingField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitButtonField(field: ButtonField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return this.simpleColumn(field);
  }

  visitFormulaField(field: FormulaField): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return resolveFormulaCompileBudget(field, this.formulaCompileBudget).andThen((options) => {
      const rootBudget = new FormulaCompileBudget(options);
      return rootBudget
        .boundary(() =>
          this.getColAlias(field).andThen((colAlias) => {
            // Skip computation if field has error - return NULL
            if (field.hasError().isError()) {
              return this.typedNullColumn(field, colAlias);
            }
            rootBudget.inspectTree(
              (check) => inspectFormulaStructure(field.expression().toString(), check),
              false
            );
            if (this.shouldUseStoredFormula(field)) {
              return ok(sql`${sql.ref(`${this.tableAlias}.${colAlias}`)}`.as(colAlias));
            }
            const translator = this.createFormulaTranslator(
              rootBudget,
              field.timeZone()?.toString()
            );
            const translated = translator.translateExpression(field.expression().toString());
            if (translated.isErr()) {
              if (isFormulaCompileBudgetError(translated.error)) return err(translated.error);
              return this.typedNullColumn(field, colAlias);
            }
            const expr = translated.value;

            const outputType = field.accept(new FieldValueTypeVisitor());
            if (outputType.isErr()) return this.typedNullColumn(field, colAlias);
            const typedSql = translator.renderExpression(expr, (value, budget) =>
              finalizeFormulaOutputSql(
                value,
                {
                  valueType: outputType.value.cellValueType,
                  multiplicity: outputType.value.isMultipleCellValue,
                },
                this.typeValidationStrategy,
                budget
              )
            );
            return typedSql.map((value) => sql.raw(value).as(colAlias));
          })
        )
        .andThen((result) => result);
    });
  }

  private shouldUseStoredFormula(field: FormulaField): boolean {
    if (!this.preferStoredLastModifiedFormula) return false;
    const hasParams = field.expression().hasLastModifiedTimeParams();
    return hasParams.isOk() && hasParams.value;
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
      if (linkFieldResult.isErr()) {
        return ok(sql.raw('NULL::jsonb').as(colAlias));
      }
      const linkField = linkFieldResult.value;
      if (linkField.foreignTableId().toString() !== field.foreignTableId().toString()) {
        return ok(sql.raw('NULL::jsonb').as(colAlias));
      }
      const orderByResult = this.getLinkOrderBy(linkField);
      if (orderByResult.isErr()) return err(orderByResult.error);
      const lookupIsMultipleResult = field
        .isMultipleCellValue()
        .map((multiplicity) => multiplicity.isMultiple());
      if (lookupIsMultipleResult.isErr()) return err(lookupIsMultipleResult.error);
      const isMultiValue = lookupIsMultipleResult.value;
      const condition = field.lookupOptions().condition();
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'lookup',
          isUnique: field.lookupOptions().isUnique(),
          foreignFieldId: field.lookupFieldId(),
          isMultiValue: this.forceLookupArrayOutput ? true : isMultiValue,
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
      const linkFieldResult = field.linkField(this.table);
      if (linkFieldResult.isErr()) {
        return this.typedNullColumn(field, colAlias);
      }
      const linkField = linkFieldResult.value;
      if (linkField.foreignTableId().toString() !== field.foreignTableId().toString()) {
        return ok(sql.raw('NULL').as(colAlias));
      }
      const orderByResult = this.getLinkOrderBy(linkField);
      if (orderByResult.isErr()) return err(orderByResult.error);
      const condition = field.config().condition();
      const lateralAlias = this.lateral.addColumn(
        field.linkFieldId(),
        field.foreignTableId().toString(),
        colAlias,
        {
          type: 'rollup',
          foreignFieldId: field.lookupFieldId(),
          expression,
          orderBy: orderByResult.value,
          condition,
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
            isUnique: options.isUnique(),
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

    if (field.hasOrderColumn()) {
      const orderColumnResult = field.orderColumnName();
      if (orderColumnResult.isErr()) return err(orderColumnResult.error);
      return ok({ source: 'foreign' as const, column: orderColumnResult.value });
    }

    return ok({ source: 'foreign' as const, column: undefined });
  }
}
