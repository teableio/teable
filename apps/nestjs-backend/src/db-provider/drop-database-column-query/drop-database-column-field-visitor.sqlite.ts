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
  FieldCore,
} from '@teable/core';
import type { IDropDatabaseColumnContext } from './drop-database-column-field-visitor.interface';

/**
 * SQLite implementation of database column drop visitor.
 */
export class DropSqliteDatabaseColumnFieldVisitor implements IFieldVisitor<string[]> {
  constructor(private readonly context: IDropDatabaseColumnContext) {}

  private dropStandardColumn(field: FieldCore): string[] {
    if (field.isLookup) {
      return [];
    }

    // Get all column names for this field
    const columnNames = field.dbFieldNames;
    const queries: string[] = [];

    for (const columnName of columnNames) {
      const dropQuery = this.context.knex
        .raw('ALTER TABLE ?? DROP COLUMN ??', [this.context.tableName, columnName])
        .toQuery();

      queries.push(dropQuery);
    }

    return queries;
  }

  private dropFormulaColumns(field: FormulaFieldCore): string[] {
    if (field.isLookup) {
      return [];
    }

    if (field.getIsPersistedAsGeneratedColumn()) {
      return this.dropStandardColumn(field);
    }

    return [];
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
    return this.dropStandardColumn(field);
  }

  visitRollupField(_field: RollupFieldCore): string[] {
    // Rollup fields don't create database columns
    return [];
  }

  // Select field types
  visitSingleSelectField(field: SingleSelectFieldCore): string[] {
    return this.dropStandardColumn(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): string[] {
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
