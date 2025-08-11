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
  FieldCore,
  ILinkFieldOptions,
  ButtonFieldCore,
} from '@teable/core';
import { DbFieldType, Relationship } from '@teable/core';
import type { Knex } from 'knex';
import { SchemaType } from '../../features/field/util';
import { GeneratedColumnQuerySupportValidatorSqlite } from '../generated-column-query/sqlite/generated-column-query-support-validator.sqlite';
import type { ICreateDatabaseColumnContext } from './create-database-column-field-visitor.interface';

/**
 * SQLite implementation of database column visitor.
 */
export class CreateSqliteDatabaseColumnFieldVisitor implements IFieldVisitor<void> {
  private sql: string[] = [];

  constructor(private readonly context: ICreateDatabaseColumnContext) {}

  getSql(): string[] {
    return this.sql;
  }

  private getSchemaType(dbFieldType: DbFieldType): SchemaType {
    switch (dbFieldType) {
      case DbFieldType.Blob:
        return SchemaType.Binary;
      case DbFieldType.Integer:
        return SchemaType.Integer;
      case DbFieldType.Json:
        // SQLite stores JSON as TEXT
        return SchemaType.Text;
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

  private createStandardColumn(field: FieldCore): void {
    if (field.isLookup) {
      return;
    }
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
    if (field.isLookup) {
      return;
    }
    // Create the standard formula column

    if (this.context.dbProvider && this.context.fieldMap) {
      const generatedColumnName = field.getGeneratedColumnName();
      const columnType = this.getSqliteColumnType(field.dbFieldType);

      // Use original expression since expansion logic has been moved
      const expressionToConvert = field.options.expression;
      // Skip if no expression
      if (!expressionToConvert) {
        return;
      }

      // Check if the formula is supported for generated columns
      const supportValidator = new GeneratedColumnQuerySupportValidatorSqlite();
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
        // SQLite syntax: GENERATED ALWAYS AS (expression) VIRTUAL/STORED
        // Note: For ALTER TABLE operations, SQLite doesn't support STORED generated columns
        const storageType = this.context.isNewTable ? 'STORED' : 'VIRTUAL';
        const notNullClause = this.context.notNull ? ' NOT NULL' : '';
        const generatedColumnDefinition = `${columnType} GENERATED ALWAYS AS (${conversionResult.sql}) ${storageType}${notNullClause}`;

        this.context.table.specificType(generatedColumnName, generatedColumnDefinition);
      }
    } else {
      this.createStandardColumn(field);
    }
  }

  private getSqliteColumnType(dbFieldType: DbFieldType): string {
    switch (dbFieldType) {
      case DbFieldType.Text:
        return 'TEXT';
      case DbFieldType.Integer:
        return 'INTEGER';
      case DbFieldType.Real:
        return 'REAL';
      case DbFieldType.Boolean:
        return 'INTEGER'; // SQLite uses INTEGER for boolean
      case DbFieldType.DateTime:
        return 'TEXT'; // SQLite stores datetime as TEXT
      case DbFieldType.Json:
        return 'TEXT'; // SQLite stores JSON as TEXT
      case DbFieldType.Blob:
        return 'BLOB';
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

  visitAutoNumberField(_field: AutoNumberFieldCore): void {
    // SQLite syntax: GENERATED ALWAYS AS (expression) STORED/VIRTUAL
    // For ALTER TABLE operations, SQLite doesn't support STORED generated columns, so use VIRTUAL
    const storageType = this.context.isNewTable ? 'STORED' : 'VIRTUAL';
    this.context.table.specificType(
      this.context.dbFieldName,
      `INTEGER GENERATED ALWAYS AS (__auto_number) ${storageType}`
    );
  }

  visitLinkField(field: LinkFieldCore): void {
    if (field.isLookup) {
      return;
    }

    // Skip foreign key creation for symmetric fields
    // A symmetric field is one that has a symmetricFieldId pointing to an existing field
    if (this.context.isSymmetricField || this.isSymmetricField(field)) {
      return;
    }

    // Handle foreign key creation (moved from createForeignKey method)
    this.createForeignKeyForLinkField(field);
  }

  private isSymmetricField(_field: LinkFieldCore): boolean {
    // A field is symmetric if it has a symmetricFieldId that points to an existing field
    // In practice, when creating symmetric fields, they are created after the main field
    // So we can check if this field's symmetricFieldId exists in the database
    // For now, we'll rely on the isSymmetricField context flag
    return false;
  }

  private createForeignKeyForLinkField(field: LinkFieldCore): void {
    const options = field.options as ILinkFieldOptions;
    const { relationship, fkHostTableName, selfKeyName, foreignKeyName, isOneWay, foreignTableId } =
      options;

    if (
      !this.context.knex ||
      !this.context.tableId ||
      !this.context.tableName ||
      !this.context.tableNameMap
    ) {
      return;
    }

    // Get table names from context
    const dbTableName = this.context.tableName;
    const foreignDbTableName = this.context.tableNameMap.get(foreignTableId);

    if (!foreignDbTableName) {
      throw new Error(`Foreign table not found: ${foreignTableId}`);
    }

    let alterTableSchema: Knex.SchemaBuilder | undefined;

    if (relationship === Relationship.ManyMany) {
      alterTableSchema = this.context.knex.schema.createTable(fkHostTableName, (table) => {
        table.increments('__id').primary();
        table
          .string(selfKeyName)
          .references('__id')
          .inTable(dbTableName)
          .withKeyName(`fk_${selfKeyName}`);
        table
          .string(foreignKeyName)
          .references('__id')
          .inTable(foreignDbTableName)
          .withKeyName(`fk_${foreignKeyName}`);
      });
    }

    if (relationship === Relationship.ManyOne) {
      alterTableSchema = this.context.knex.schema.alterTable(fkHostTableName, (table) => {
        table
          .string(foreignKeyName)
          .references('__id')
          .inTable(foreignDbTableName)
          .withKeyName(`fk_${foreignKeyName}`);
      });
    }

    if (relationship === Relationship.OneMany) {
      if (isOneWay) {
        alterTableSchema = this.context.knex.schema.createTable(fkHostTableName, (table) => {
          table.increments('__id').primary();
          table
            .string(selfKeyName)
            .references('__id')
            .inTable(dbTableName)
            .withKeyName(`fk_${selfKeyName}`);
          table.string(foreignKeyName).references('__id').inTable(foreignDbTableName);
          table.unique([selfKeyName, foreignKeyName], {
            indexName: `index_${selfKeyName}_${foreignKeyName}`,
          });
        });
      } else {
        alterTableSchema = this.context.knex.schema.alterTable(fkHostTableName, (table) => {
          table
            .string(selfKeyName)
            .references('__id')
            .inTable(dbTableName)
            .withKeyName(`fk_${selfKeyName}`);
        });
      }
    }

    // assume options is from the main field (user created one)
    if (relationship === Relationship.OneOne) {
      alterTableSchema = this.context.knex.schema.alterTable(fkHostTableName, (table) => {
        if (foreignKeyName === '__id') {
          throw new Error('can not use __id for foreignKeyName');
        }
        table.string(foreignKeyName).references('__id').inTable(foreignDbTableName);
        table.unique([foreignKeyName], {
          indexName: `index_${foreignKeyName}`,
        });
      });
    }

    if (!alterTableSchema) {
      throw new Error('alterTableSchema is undefined');
    }

    // Store the SQL queries to be executed later
    for (const sqlObj of alterTableSchema.toSQL()) {
      // skip sqlite pragma
      if (sqlObj.sql.startsWith('PRAGMA')) {
        continue;
      }
      this.sql.push(sqlObj.sql);
    }
  }

  visitRollupField(_field: RollupFieldCore): void {
    return;
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

  visitButtonField(field: ButtonFieldCore): void {
    this.createStandardColumn(field);
  }

  visitCreatedTimeField(_field: CreatedTimeFieldCore): void {
    const storageType = this.context.isNewTable ? 'STORED' : 'VIRTUAL';
    this.context.table.specificType(
      this.context.dbFieldName,
      `TEXT GENERATED ALWAYS AS (__created_time) ${storageType}`
    );
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): void {
    const storageType = this.context.isNewTable ? 'STORED' : 'VIRTUAL';
    this.context.table.specificType(
      this.context.dbFieldName,
      `TEXT GENERATED ALWAYS AS (__last_modified_time) ${storageType}`
    );
  }

  // User field types
  visitUserField(field: UserFieldCore): void {
    this.createStandardColumn(field);
  }

  visitCreatedByField(_field: CreatedByFieldCore): void {
    const storageType = this.context.isNewTable ? 'STORED' : 'VIRTUAL';
    this.context.table.specificType(
      this.context.dbFieldName,
      `INTEGER GENERATED ALWAYS AS (__created_by) ${storageType}`
    );
  }

  visitLastModifiedByField(_field: LastModifiedByFieldCore): void {
    const storageType = this.context.isNewTable ? 'STORED' : 'VIRTUAL';
    this.context.table.specificType(
      this.context.dbFieldName,
      `INTEGER GENERATED ALWAYS AS (__last_modified_by) ${storageType}`
    );
  }
}
