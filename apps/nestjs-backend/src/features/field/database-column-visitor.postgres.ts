import type {
  AttachmentFieldCore,
  AutoNumberFieldCore,
  CheckboxFieldCore,
  CreatedByFieldCore,
  CreatedTimeFieldCore,
  DateFieldCore,
  FormulaFieldCore,
  LastModifiedByFieldCore,
  LastModifiedTimeFieldCore,
  LinkFieldCore,
  LongTextFieldCore,
  MultipleSelectFieldCore,
  NumberFieldCore,
  RatingFieldCore,
  RollupFieldCore,
  SingleLineTextFieldCore,
  SingleSelectFieldCore,
  UserFieldCore,
  IFieldVisitor,
} from '@teable/core';
import { DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IFormulaConversionContext } from '../../db-provider/generated-column-query/generated-column-query.interface';
import { GeneratedColumnQuerySupportValidatorPostgres } from '../../db-provider/generated-column-query/generated-column-query.interface';
import { FormulaSupportValidator } from './formula-support-validator';
import { SchemaType } from './util';

/**
 * Context interface for database column creation
 */
export interface IDatabaseColumnContext {
  /** Knex table builder instance */
  table: Knex.CreateTableBuilder;
  /** Field ID */
  fieldId: string;
  /** Database field name */
  dbFieldName: string;
  /** Whether the field is unique */
  unique?: boolean;
  /** Whether the field is not null */
  notNull?: boolean;
  /** Database provider for formula conversion */
  dbProvider?: IDbProvider;
  /** Field map for formula conversion context */
  fieldMap?: {
    [fieldId: string]: {
      columnName: string;
      fieldType?: string;
      dbGenerated?: boolean;
      expandedExpression?: string;
    };
  };
  /** Whether this is a new table creation (affects SQLite generated columns) */
  isNewTable?: boolean;
}

/**
 * PostgreSQL implementation of database column visitor.
 * Supports STORED generated columns for formula fields with dbGenerated=true.
 */
export class PostgresDatabaseColumnVisitor implements IFieldVisitor<void> {
  constructor(private readonly context: IDatabaseColumnContext) {}

  private getSchemaType(dbFieldType: DbFieldType): SchemaType {
    switch (dbFieldType) {
      case DbFieldType.Blob:
        return SchemaType.Binary;
      case DbFieldType.Integer:
        return SchemaType.Integer;
      case DbFieldType.Json:
        // PostgreSQL supports native JSONB
        return SchemaType.Jsonb;
      case DbFieldType.Real:
        return SchemaType.Double;
      case DbFieldType.Text:
        return SchemaType.Text;
      case DbFieldType.DateTime:
        return SchemaType.Datetime;
      case DbFieldType.Boolean:
        return SchemaType.Boolean;
      default:
        throw new Error(`Unsupported DbFieldType: ${dbFieldType}`);
    }
  }

  private createStandardColumn(field: { dbFieldType: DbFieldType }): void {
    const schemaType = this.getSchemaType(field.dbFieldType);
    const column = this.context.table[schemaType](this.context.dbFieldName);

    if (this.context.notNull) {
      column.notNullable();
    }

    if (this.context.unique) {
      column.unique();
    }
  }

  private createFormulaColumns(field: FormulaFieldCore): void {
    // Create the standard formula column
    this.createStandardColumn(field);

    // If dbGenerated is enabled, create a generated column or fallback column
    if (field.options.dbGenerated && this.context.dbProvider && this.context.fieldMap) {
      const generatedColumnName = field.getGeneratedColumnName();
      const columnType = this.getPostgresColumnType(field.dbFieldType);

      // Use expanded expression if available, otherwise use original expression
      const fieldInfo = this.context.fieldMap[field.id];
      const expressionToConvert = fieldInfo?.expandedExpression || field.options.expression;

      // Check if the formula is supported for generated columns
      const supportValidator = new GeneratedColumnQuerySupportValidatorPostgres();
      const formulaValidator = new FormulaSupportValidator(supportValidator);
      const isSupported = formulaValidator.validateFormula(expressionToConvert);

      if (isSupported) {
        try {
          const conversionContext: IFormulaConversionContext = {
            fieldMap: this.context.fieldMap,
            isGeneratedColumn: true, // Mark this as a generated column context
          };

          const conversionResult = this.context.dbProvider.convertFormula(
            expressionToConvert,
            conversionContext
          );

          // Create generated column using specificType
          // PostgreSQL syntax: GENERATED ALWAYS AS (expression) STORED
          const generatedColumnDefinition = `${columnType} GENERATED ALWAYS AS (${conversionResult.sql}) STORED`;

          this.context.table.specificType(generatedColumnName, generatedColumnDefinition);
        } catch (error) {
          // If formula conversion fails, create fallback column
          console.warn(
            `Failed to create generated column for formula field ${field.id}, creating fallback column:`,
            error
          );
          this.createFallbackColumn(generatedColumnName, columnType);
        }
      } else {
        // Formula contains unsupported functions, create fallback column
        console.info(
          `Formula contains unsupported functions for generated column, creating fallback column for field ${field.id}`
        );
        this.createFallbackColumn(generatedColumnName, columnType);
      }
    }
  }

  /**
   * Creates a fallback column when generated column creation is not supported
   * @param columnName The name of the column to create
   * @param columnType The PostgreSQL column type
   */
  private createFallbackColumn(columnName: string, columnType: string): void {
    // Create a regular column with the same name and type as the generated column would have
    this.context.table.specificType(columnName, columnType);
  }

  private getPostgresColumnType(dbFieldType: DbFieldType): string {
    switch (dbFieldType) {
      case DbFieldType.Text:
        return 'TEXT';
      case DbFieldType.Integer:
        return 'INTEGER';
      case DbFieldType.Real:
        return 'DOUBLE PRECISION';
      case DbFieldType.Boolean:
        return 'BOOLEAN';
      case DbFieldType.DateTime:
        return 'TIMESTAMP';
      case DbFieldType.Json:
        return 'JSONB';
      case DbFieldType.Blob:
        return 'BYTEA';
      default:
        return 'TEXT';
    }
  }

  // Basic field types
  visitNumberField(field: NumberFieldCore): void {
    this.createStandardColumn(field);
  }

  visitSingleLineTextField(field: SingleLineTextFieldCore): void {
    this.createStandardColumn(field);
  }

  visitLongTextField(field: LongTextFieldCore): void {
    this.createStandardColumn(field);
  }

  visitAttachmentField(field: AttachmentFieldCore): void {
    this.createStandardColumn(field);
  }

  visitCheckboxField(field: CheckboxFieldCore): void {
    this.createStandardColumn(field);
  }

  visitDateField(field: DateFieldCore): void {
    this.createStandardColumn(field);
  }

  visitRatingField(field: RatingFieldCore): void {
    this.createStandardColumn(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): void {
    this.createStandardColumn(field);
  }

  visitLinkField(field: LinkFieldCore): void {
    this.createStandardColumn(field);
  }

  visitRollupField(field: RollupFieldCore): void {
    this.createStandardColumn(field);
  }

  // Select field types
  visitSingleSelectField(field: SingleSelectFieldCore): void {
    this.createStandardColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): void {
    this.createStandardColumn(field);
  }

  // Formula field types
  visitFormulaField(field: FormulaFieldCore): void {
    this.createFormulaColumns(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): void {
    this.createStandardColumn(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): void {
    this.createStandardColumn(field);
  }

  // User field types
  visitUserField(field: UserFieldCore): void {
    this.createStandardColumn(field);
  }

  visitCreatedByField(field: CreatedByFieldCore): void {
    this.createStandardColumn(field);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): void {
    this.createStandardColumn(field);
  }
}
