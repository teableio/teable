import {
  AbstractFieldVisitor,
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
  type FormulaField,
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
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { CreateTableBuilder, Kysely } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  createFieldSchemaRules,
  createSchemaRuleContext,
  FkColumnRule,
  GeneratedColumnRule,
  OrderColumnRule,
  PostgresSchemaIntrospector,
  schemaRuleResolver,
  type FieldSchemaRulesContext,
  type SchemaRuleContext,
} from '../rules';
import type { ISchemaRule } from '../rules/core';
import type { TableSchemaStatementBuilder } from '../rules/core';
import type { TableIdentifier } from '../rules/helpers';
import { resolveColumnName, resolveColumnType } from './PostgresTableSchemaFieldColumn';

type ICreateTableBuilder = CreateTableBuilder<string, string>;

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

export const buildTableLocationsById = (
  tables: ReadonlyArray<Table>
): Result<ReadonlyMap<string, TableIdentifier>, DomainError> =>
  safeTry<ReadonlyMap<string, TableIdentifier>, DomainError>(function* () {
    const locations = new Map<string, TableIdentifier>();
    for (const table of tables) {
      const location = yield* table
        .dbTableName()
        .andThen((name) => name.split({ defaultSchema: null }));
      locations.set(table.id().toString(), {
        schema: location.schema,
        tableName: location.tableName,
      });
    }
    return ok(locations);
  });

/**
 * Visitor that generates schema statements for field creation.
 *
 * This visitor uses the rules system internally to generate statements.
 * It provides two modes:
 * - `forTableCreation`: Adds columns to a CreateTableBuilder (for CREATE TABLE)
 * - `forSchemaUpdate`: Generates ALTER TABLE statements (for adding fields to existing tables)
 */
export class PostgresTableSchemaFieldCreateVisitor extends AbstractFieldVisitor<
  ReadonlyArray<TableSchemaStatementBuilder>
> {
  private readonly createTableHelperColumnNames = new Set<string>();

  private constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private rulesContext: FieldSchemaRulesContext,
    private readonly builderRef?: ICreateTableBuilderRef
  ) {
    super();
  }

  /**
   * Creates a visitor for table creation (adds columns to CreateTableBuilder).
   * Used when creating a new table with CREATE TABLE.
   */
  static forTableCreation(params: {
    builderRef: ICreateTableBuilderRef;
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
    tableLocationsById?: ReadonlyMap<string, TableIdentifier>;
    optimizeForEmptyTables?: boolean;
  }): PostgresTableSchemaFieldCreateVisitor {
    return new PostgresTableSchemaFieldCreateVisitor(
      params.db,
      {
        schema: params.schema,
        tableName: params.tableName,
        tableId: params.tableId,
        tableLocationsById: params.tableLocationsById,
        optimizeForEmptyTables: params.optimizeForEmptyTables,
      },
      params.builderRef
    );
  }

  /**
   * Creates a visitor for schema updates (generates ALTER TABLE statements).
   * Used when adding fields to an existing table.
   */
  static forSchemaUpdate(params: {
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
    tableLocationsById?: ReadonlyMap<string, TableIdentifier>;
    optimizeForEmptyTables?: boolean;
  }): PostgresTableSchemaFieldCreateVisitor {
    return new PostgresTableSchemaFieldCreateVisitor(params.db, {
      schema: params.schema,
      tableName: params.tableName,
      tableId: params.tableId,
      tableLocationsById: params.tableLocationsById,
      optimizeForEmptyTables: params.optimizeForEmptyTables,
    });
  }

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  /**
   * Applies the visitor to a table or array of fields.
   */
  apply(table: Table): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
  apply(
    fields: ReadonlyArray<Field>
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
  apply(
    tableOrFields: Table | ReadonlyArray<Field>
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const fields = PostgresTableSchemaFieldCreateVisitor.isFieldArray(tableOrFields)
        ? tableOrFields
        : tableOrFields.getFields();
      if (!PostgresTableSchemaFieldCreateVisitor.isFieldArray(tableOrFields)) {
        const tableLocationsById = new Map([
          ...(visitor.rulesContext.tableLocationsById ?? new Map<string, TableIdentifier>()),
          ...(yield* buildTableLocationsById([tableOrFields])),
        ]);
        visitor.rulesContext = {
          ...visitor.rulesContext,
          tableLocationsById,
        };
      }
      const statements: Array<TableSchemaStatementBuilder> = [];

      for (const field of fields) {
        const fieldStatements = yield* field.accept(visitor);
        statements.push(...fieldStatements);
      }

      return ok(statements);
    });
  }

  /**
   * Creates the rule context for a field.
   */
  private createRuleContext(field: Field): SchemaRuleContext {
    return createSchemaRuleContext({
      db: this.db,
      introspector: new PostgresSchemaIntrospector(this.db),
      schema: this.rulesContext.schema,
      tableName: this.rulesContext.tableName,
      tableId: this.rulesContext.tableId,
      field,
      optimizeForEmptyTables: this.rulesContext.optimizeForEmptyTables,
    });
  }

  private addCreateTableColumnFromRules(
    field: Field,
    rules: ReadonlyArray<ISchemaRule>
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return safeTry<ReadonlyArray<ISchemaRule>, DomainError>(
      function* (this: PostgresTableSchemaFieldCreateVisitor) {
        if (!this.builderRef) {
          return ok(rules);
        }

        const fieldId = field.id().toString();
        const columnRuleId = `column:${fieldId}`;
        const linkValueColumnRuleId = `link_value_column:${fieldId}`;
        const generatedColumnRuleId = `generated_column:${fieldId}`;
        const fkColumnRuleId = `fk_column:${fieldId}`;
        const orderColumnRuleId = `order_column:${fieldId}`;
        const skipRuleIds = new Set<string>();
        const currentTable: TableIdentifier = {
          schema: this.rulesContext.schema,
          tableName: this.rulesContext.tableName,
        };

        const generatedColumnRule = rules.find(
          (rule): rule is GeneratedColumnRule =>
            rule.id === generatedColumnRuleId && rule instanceof GeneratedColumnRule
        );

        if (generatedColumnRule) {
          const columnName = yield* resolveColumnName(field);
          this.builderRef.builder = this.builderRef.builder.addColumn(
            columnName,
            generatedColumnRule.createTableColumnType()
          );
          skipRuleIds.add(generatedColumnRuleId);
        } else if (rules.some((rule) => rule.id === columnRuleId)) {
          const columnName = yield* resolveColumnName(field);
          const dataType = yield* resolveColumnType(field);
          this.builderRef.builder = this.builderRef.builder.addColumn(columnName, dataType);
          skipRuleIds.add(columnRuleId);
          skipRuleIds.add(`generated_meta:${fieldId}`);
        } else if (rules.some((rule) => rule.id === linkValueColumnRuleId)) {
          const columnName = yield* resolveColumnName(field);
          this.builderRef.builder = this.builderRef.builder.addColumn(columnName, 'jsonb');
          skipRuleIds.add(linkValueColumnRuleId);
        }

        const fkColumnRule = rules.find(
          (rule): rule is FkColumnRule => rule.id === fkColumnRuleId && rule instanceof FkColumnRule
        );
        const fkColumn = fkColumnRule?.createTableColumnForTarget(currentTable);
        if (fkColumn) {
          if (!this.createTableHelperColumnNames.has(fkColumn.columnName)) {
            this.builderRef.builder = this.builderRef.builder.addColumn(
              fkColumn.columnName,
              fkColumn.dataType
            );
            this.createTableHelperColumnNames.add(fkColumn.columnName);
          }
          skipRuleIds.add(fkColumnRuleId);
        }

        const orderColumnRule = rules.find(
          (rule): rule is OrderColumnRule =>
            rule.id === orderColumnRuleId && rule instanceof OrderColumnRule
        );
        const orderColumn = orderColumnRule?.createTableColumnForTarget(currentTable);
        if (orderColumn) {
          if (!this.createTableHelperColumnNames.has(orderColumn.columnName)) {
            this.builderRef.builder = this.builderRef.builder.addColumn(
              orderColumn.columnName,
              orderColumn.dataType
            );
            this.createTableHelperColumnNames.add(orderColumn.columnName);
          }
          skipRuleIds.add(orderColumnRuleId);
        }

        if (skipRuleIds.size === 0) {
          return ok(rules);
        }

        return ok(rules.filter((rule) => !skipRuleIds.has(rule.id)));
      }.bind(this)
    );
  }

  /**
   * Generates statements using the rules system.
   * For table creation mode, it delegates to a specialized handler that
   * modifies the CreateTableBuilder for column additions.
   */
  private generateStatementsFromRules(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(
      function* (this: PostgresTableSchemaFieldCreateVisitor) {
        const rulesResult = createFieldSchemaRules(field, this.rulesContext);
        const rules = yield* rulesResult.andThen((rules) =>
          this.addCreateTableColumnFromRules(field, rules)
        );

        const ctx = this.createRuleContext(field);
        const statementsResult = schemaRuleResolver.upAll(rules, ctx);
        return statementsResult;
      }.bind(this)
    );
  }

  // All field types delegate to the rules system
  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitNumberField(
    field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitRollupField(
    field: RollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitDateField(
    field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitCreatedTimeField(
    field: CreatedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitUserField(
    field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitButtonField(
    field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitLinkField(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  override visitLookupField(
    field: LookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.generateStatementsFromRules(field);
  }
}
