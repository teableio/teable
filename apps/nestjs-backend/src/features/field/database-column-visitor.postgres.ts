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
  IFormulaConversionContext,
  IFieldMap,
} from '@teable/core';
import { DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import { GeneratedColumnQuerySupportValidatorPostgres } from '../../db-provider/generated-column-query/postgres/generated-column-query-support-validator.postgres';
import type { IFieldInstance } from './model/factory';
import type { FormulaFieldDto } from './model/field-dto/formula-field.dto';
import { SchemaType } from './util';

/**
 * Context interface for database column creation
 */
export interface IDatabaseAddColumnContext {
  /** Knex table builder instance */
  table: Knex.CreateTableBuilder;
  /** Field ID */
  fieldId: string;
  /** the Field instance to add */
  field: IFieldInstance;
  /** Database field name */
  dbFieldName: string;
  /** Whether the field is unique */
  unique?: boolean;
  /** Whether the field is not null */
  notNull?: boolean;
  /** Database provider for formula conversion */
  dbProvider?: IDbProvider;
  /** Field map for formula conversion context */
  fieldMap?: IFieldMap;
  /** Whether this is a new table creation (affects SQLite generated columns) */
  isNewTable?: boolean;
}

/**
 * PostgreSQL implementation of database column visitor.
 */
export class PostgresDatabaseColumnVisitor implements IFieldVisitor<void> {
  constructor(private readonly context: IDatabaseAddColumnContext) {}

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
    if (this.context.dbProvider && this.context.fieldMap) {
      const generatedColumnName = field.getGeneratedColumnName();
      const columnType = this.getPostgresColumnType(field.dbFieldType);

      // Use original expression since expansion logic has been moved
      const expressionToConvert = field.options.expression;

      // Check if the formula is supported for generated columns
      const supportValidator = new GeneratedColumnQuerySupportValidatorPostgres();
      const isSupported = field.validateGeneratedColumnSupport(supportValidator);

      if (isSupported) {
        const conversionContext: IFormulaConversionContext = {
          fieldMap: this.context.fieldMap || new Map(),
          isGeneratedColumn: true, // Mark this as a generated column context
        };

        const conversionResult = this.context.dbProvider.convertFormulaToGeneratedColumn(
          expressionToConvert,
          conversionContext
        );

        // Create generated column using specificType
        // PostgreSQL syntax: GENERATED ALWAYS AS (expression) STORED
        const generatedColumnDefinition = `${columnType} GENERATED ALWAYS AS (${conversionResult.sql}) STORED`;

        this.context.table.specificType(generatedColumnName, generatedColumnDefinition);
        (this.context.field as FormulaFieldDto).setMetadata({ persistedAsGeneratedColumn: true });
      }
    } else {
      // Create the standard formula column
      this.createStandardColumn(field);
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
