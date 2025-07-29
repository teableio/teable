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
import { DbFieldType, CellValueType } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IFormulaConversionContext } from '../../db-provider/formula-query/formula-query.interface';
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
    [fieldId: string]: { columnName: string };
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

  private generateGeneratedColumnName(): string {
    // Use the same naming convention as unique keys: ___suffix
    return `${this.context.dbFieldName}___generated`;
  }

  private createFormulaColumns(field: FormulaFieldCore): void {
    // Create the standard formula column
    this.createStandardColumn(field);

    // If dbGenerated is enabled, create a generated column
    if (field.options.dbGenerated && this.context.dbProvider && this.context.fieldMap) {
      try {
        const generatedColumnName = this.generateGeneratedColumnName();

        const conversionContext: IFormulaConversionContext = {
          fieldMap: this.context.fieldMap,
        };

        const conversionResult = this.context.dbProvider.convertFormula(
          field.options.expression,
          conversionContext
        );

        // Create generated column using specificType
        // PostgreSQL syntax: GENERATED ALWAYS AS (expression) STORED
        const columnType = this.getPostgresColumnType(field.dbFieldType);
        const generatedColumnDefinition = `${columnType} GENERATED ALWAYS AS (${conversionResult.sql}) STORED`;

        this.context.table.specificType(generatedColumnName, generatedColumnDefinition);
      } catch (error) {
        // If formula conversion fails, skip generated column creation
        // The standard column will still be created for manual calculation
        console.warn(`Failed to create generated column for formula field ${field.id}:`, error);
      }
    }
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
