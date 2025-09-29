/* eslint-disable sonarjs/no-duplicate-string */
import { Relationship } from '@teable/core';
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
  ConditionalRollupFieldCore,
  SingleLineTextFieldCore,
  SingleSelectFieldCore,
  UserFieldCore,
  IFieldVisitor,
  FieldCore,
  ILinkFieldOptions,
  ButtonFieldCore,
} from '@teable/core';
import { DropColumnOperationType } from './drop-database-column-field-visitor.interface';
import type { IDropDatabaseColumnContext } from './drop-database-column-field-visitor.interface';

/**
 * PostgreSQL implementation of database column drop visitor.
 */
export class DropPostgresDatabaseColumnFieldVisitor implements IFieldVisitor<string[]> {
  constructor(private readonly context: IDropDatabaseColumnContext) {}

  private dropStandardColumn(field: FieldCore): string[] {
    // Get all column names for this field
    const columnNames = field.dbFieldNames;
    const queries: string[] = [];

    for (const columnName of columnNames) {
      // Use CASCADE to automatically drop dependent objects (like generated columns)
      // This is safe because we handle application-level dependencies separately
      const dropQuery = this.context.knex
        .raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ?? CASCADE', [
          this.context.tableName,
          columnName,
        ])
        .toQuery();

      queries.push(dropQuery);
    }

    return queries;
  }

  private dropFormulaColumns(field: FormulaFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  private dropForeignKeyForLinkField(field: LinkFieldCore): string[] {
    const options = field.options as ILinkFieldOptions;
    const { fkHostTableName, relationship, selfKeyName, foreignKeyName, isOneWay } = options;
    const queries: string[] = [];

    // Check operation type - only drop foreign keys for complete field deletion
    const operationType = this.context.operationType || DropColumnOperationType.DELETE_FIELD;

    // For field conversion or symmetric field deletion, preserve foreign key relationships
    // as they may still be needed by other fields
    if (
      operationType === DropColumnOperationType.CONVERT_FIELD ||
      operationType === DropColumnOperationType.DELETE_SYMMETRIC_FIELD
    ) {
      return queries; // Return empty array - don't drop foreign keys
    }

    // Helper function to drop table
    const dropTable = (tableName: string): string => {
      return this.context.knex.raw('DROP TABLE IF EXISTS ?? CASCADE', [tableName]).toQuery();
    };

    // Helper function to drop column with index and order column
    const dropColumn = (tableName: string, columnName: string): string[] => {
      const dropQueries: string[] = [];

      // Drop index first
      dropQueries.push(
        this.context.knex.raw('DROP INDEX IF EXISTS ??', [`index_${columnName}`]).toQuery()
      );

      // Drop main column
      dropQueries.push(
        this.context.knex
          .raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ?? CASCADE', [tableName, columnName])
          .toQuery()
      );

      // Drop order column if it exists
      dropQueries.push(
        this.context.knex
          .raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ?? CASCADE', [
            tableName,
            `${columnName}_order`,
          ])
          .toQuery()
      );

      return dropQueries;
    };

    // Handle different relationship types - only for complete field deletion
    if (relationship === Relationship.ManyMany && fkHostTableName.includes('junction_')) {
      queries.push(dropTable(fkHostTableName));
    }

    if (relationship === Relationship.ManyOne) {
      queries.push(...dropColumn(fkHostTableName, foreignKeyName));
    }

    if (relationship === Relationship.OneMany) {
      if (isOneWay && fkHostTableName.includes('junction_')) {
        queries.push(dropTable(fkHostTableName));
      } else if (!isOneWay) {
        // For non-one-way OneMany relationships, drop the selfKeyName column and its order column
        queries.push(...dropColumn(fkHostTableName, selfKeyName));
      }
    }

    if (relationship === Relationship.OneOne) {
      const columnToDrop = foreignKeyName === '__id' ? selfKeyName : foreignKeyName;
      queries.push(...dropColumn(fkHostTableName, columnToDrop));
    }

    return queries;
  }

  // Basic field types
  visitNumberField(field: NumberFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitSingleLineTextField(field: SingleLineTextFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitLongTextField(field: LongTextFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitAttachmentField(field: AttachmentFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitCheckboxField(field: CheckboxFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitDateField(field: DateFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitRatingField(field: RatingFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitLinkField(field: LinkFieldCore): string[] {
    const opts = field.options as ILinkFieldOptions;
    const rel = opts?.relationship;
    const inferredFkName =
      opts?.foreignKeyName ??
      (rel === Relationship.ManyOne || rel === Relationship.OneOne ? field.dbFieldName : undefined);
    const inferredSelfName =
      opts?.selfKeyName ??
      (rel === Relationship.OneMany && opts?.isOneWay === false ? field.dbFieldName : undefined);
    const conflictNames = new Set<string>();
    if (inferredFkName) conflictNames.add(inferredFkName);
    if (inferredSelfName) conflictNames.add(inferredSelfName);

    const queries: string[] = [];
    // Drop the separate base column only if it does not conflict with FK columns
    if (!conflictNames.has(field.dbFieldName)) {
      queries.push(...this.dropStandardColumn(field));
    }

    // Always drop FK/junction artifacts for link fields
    queries.push(...this.dropForeignKeyForLinkField(field));
    return queries;
  }

  visitRollupField(field: RollupFieldCore): string[] {
    // Drop underlying base column for rollup fields
    return this.dropStandardColumn(field);
  }

  visitConditionalRollupField(field: ConditionalRollupFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  // Select field types
  visitSingleSelectField(field: SingleSelectFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitButtonField(field: ButtonFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  // Formula field types
  visitFormulaField(field: FormulaFieldCore): string[] {
    return this.dropFormulaColumns(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  // User field types
  visitUserField(field: UserFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitCreatedByField(field: CreatedByFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): string[] {
    return this.dropStandardColumn(field);
  }
}
