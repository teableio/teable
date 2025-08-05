import { Logger } from '@nestjs/common';
import type {
  ILinkFieldOptions,
  ILookupOptionsVo,
  IFieldVisitor,
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
} from '@teable/core';
import { FieldType, DriverClient } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';

import { FieldSelectVisitor } from './field-select-visitor';
import type { IFieldInstance } from './model/factory';

export interface ICteResult {
  cteName?: string;
  hasChanges: boolean;
  cteCallback?: (qb: Knex.QueryBuilder) => void;
}

export interface IFieldCteContext {
  mainTableName: string;
  fieldMap: Map<string, IFieldInstance>;
  tableNameMap: Map<string, string>; // tableId -> dbTableName
}

/**
 * Field CTE Visitor
 *
 * This visitor generates Common Table Expressions (CTEs) for fields that need them.
 * Currently focuses on Link fields for real-time aggregation queries instead of
 * reading pre-computed values.
 *
 * Each field type can decide whether it needs a CTE and how to generate it.
 */
export class FieldCteVisitor implements IFieldVisitor<ICteResult> {
  private logger = new Logger(FieldCteVisitor.name);
  private readonly processedForeignTables = new Set<string>();

  constructor(
    private readonly dbProvider: IDbProvider,
    private readonly context: IFieldCteContext
  ) {}

  /**
   * Generate JSON aggregation function for Link fields (creates objects with id and title)
   */
  private getLinkJsonAggregationFunction(tableAlias: string, fieldExpression: string): string {
    const driver = this.dbProvider.driver;

    // Use table alias for cleaner SQL
    const recordIdRef = `${tableAlias}."__id"`;
    const titleRef = fieldExpression;

    if (driver === DriverClient.Pg) {
      return `json_agg(json_build_object('id', ${recordIdRef}, 'title', ${titleRef}))`;
    } else if (driver === DriverClient.Sqlite) {
      return `json_group_array(json_object('id', ${recordIdRef}, 'title', ${titleRef}))`;
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  /**
   * Check if field is a Lookup field and generate CTE if needed
   */
  private checkAndGenerateLookupCte(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    id: string;
  }): ICteResult {
    if (field.isLookup && field.lookupOptions) {
      return this.generateForeignTableCte(field.lookupOptions.foreignTableId);
    }
    return { hasChanges: false };
  }

  /**
   * Generate CTE for a foreign table (shared by multiple Lookup fields)
   */
  private generateForeignTableCte(foreignTableId: string): ICteResult {
    // Check if we've already processed this foreign table
    if (this.processedForeignTables.has(foreignTableId)) {
      // Return existing CTE info
      const cteName = this.getCteNameForForeignTable(foreignTableId);
      return { cteName, hasChanges: false }; // Already processed
    }

    // Mark as processed
    this.processedForeignTables.add(foreignTableId);

    // Get foreign table name from context
    const foreignTableName = this.context.tableNameMap.get(foreignTableId);
    if (!foreignTableName) {
      this.logger.debug(`Foreign table not found: ${foreignTableId}`);
      return { hasChanges: false };
    }

    // Collect all Lookup fields that reference this foreign table
    const lookupFields = this.collectLookupFieldsForForeignTable(foreignTableId);
    if (lookupFields.length === 0) {
      return { hasChanges: false };
    }

    const cteName = this.getCteNameForForeignTable(foreignTableId);
    const { mainTableName } = this.context;

    // Create CTE callback function
    // eslint-disable-next-line sonarjs/cognitive-complexity
    const cteCallback = (qb: Knex.QueryBuilder) => {
      const mainAlias = 'm';
      const junctionAlias = 'j';
      const foreignAlias = 'f';

      // Build select columns
      const selectColumns = [`${mainAlias}.__id as main_record_id`];

      // Add Link field JSON aggregation if there's a Link field for this foreign table
      const linkField = this.findLinkFieldForForeignTable(foreignTableId);
      if (linkField) {
        const linkOptions = linkField.options as ILinkFieldOptions;
        const linkLookupField = this.context.fieldMap.get(linkOptions.lookupFieldId);
        if (linkLookupField) {
          // Create FieldSelectVisitor with table alias
          const tempQb = qb.client.queryBuilder();
          const fieldSelectVisitor = new FieldSelectVisitor(
            tempQb,
            this.dbProvider,
            { fieldMap: this.context.fieldMap },
            undefined, // No fieldCteMap to prevent recursive Lookup processing
            foreignAlias
          );

          // Use the visitor to get the correct field selection
          const fieldResult = linkLookupField.accept(fieldSelectVisitor);
          const fieldExpression =
            typeof fieldResult === 'string' ? fieldResult : fieldResult.toSQL().sql;

          const jsonAggFunction = this.getLinkJsonAggregationFunction(
            foreignAlias,
            fieldExpression
          );
          selectColumns.push(qb.client.raw(`${jsonAggFunction} as link_value`));
        }
      }

      // Add Lookup field selections using FieldSelectVisitor
      for (const lookupField of lookupFields) {
        const targetField = this.context.fieldMap.get(lookupField.lookupOptions!.lookupFieldId);
        if (targetField) {
          // Create FieldSelectVisitor with table alias
          const tempQb = qb.client.queryBuilder();
          const fieldSelectVisitor = new FieldSelectVisitor(
            tempQb,
            this.dbProvider,
            { fieldMap: this.context.fieldMap },
            undefined, // No fieldCteMap to prevent recursive Lookup processing
            foreignAlias
          );

          // Use the visitor to get the correct field selection
          const fieldResult = targetField.accept(fieldSelectVisitor);
          const fieldExpression =
            typeof fieldResult === 'string' ? fieldResult : fieldResult.toSQL().sql;

          if (lookupField.isMultipleCellValue) {
            const jsonAggFunction = this.getJsonAggregationFunction(fieldExpression);
            selectColumns.push(qb.client.raw(`${jsonAggFunction} as "lookup_${lookupField.id}"`));
          } else {
            selectColumns.push(qb.client.raw(`${fieldExpression} as "lookup_${lookupField.id}"`));
          }
        }
      }

      // Get JOIN information from the first Lookup field (they should all have the same JOIN logic for the same foreign table)
      const firstLookup = lookupFields[0];
      const { fkHostTableName, selfKeyName, foreignKeyName } = firstLookup.lookupOptions!;

      qb.select(selectColumns)
        .from(`${mainTableName} as ${mainAlias}`)
        .leftJoin(
          `${fkHostTableName} as ${junctionAlias}`,
          `${mainAlias}.__id`,
          `${junctionAlias}.${selfKeyName}`
        )
        .leftJoin(
          `${foreignTableName} as ${foreignAlias}`,
          `${junctionAlias}.${foreignKeyName}`,
          `${foreignAlias}.__id`
        )
        .groupBy(`${mainAlias}.__id`);
    };

    this.logger.debug(`Generated foreign table CTE for ${foreignTableId} with name ${cteName}`);

    return { cteName, hasChanges: true, cteCallback };
  }

  /**
   * Generate CTE name for a foreign table
   */
  private getCteNameForForeignTable(foreignTableId: string): string {
    return `cte_${foreignTableId.replace(/[^a-z0-9]/gi, '_')}`;
  }

  /**
   * Collect all Lookup fields that reference a specific foreign table
   */
  private collectLookupFieldsForForeignTable(foreignTableId: string): Array<{
    id: string;
    isMultipleCellValue?: boolean;
    lookupOptions?: ILookupOptionsVo;
  }> {
    const lookupFields: Array<{
      id: string;
      isMultipleCellValue?: boolean;
      lookupOptions?: ILookupOptionsVo;
    }> = [];

    // Iterate through all fields in context to find Lookup fields for this foreign table
    for (const [fieldId, field] of this.context.fieldMap) {
      if (field.isLookup && field.lookupOptions?.foreignTableId === foreignTableId) {
        lookupFields.push({
          id: fieldId,
          isMultipleCellValue: field.isMultipleCellValue,
          lookupOptions: field.lookupOptions,
        });
      }
    }

    return lookupFields;
  }

  /**
   * Find Link field that references the same foreign table
   */
  private findLinkFieldForForeignTable(foreignTableId: string): IFieldInstance | null {
    for (const [, field] of this.context.fieldMap) {
      if (field.type === FieldType.Link && !field.isLookup) {
        const options = field.options as ILinkFieldOptions;
        if (options.foreignTableId === foreignTableId) {
          return field;
        }
      }
    }
    return null;
  }

  /**
   * Generate JSON array aggregation function for multiple values based on database type
   */
  private getJsonAggregationFunction(fieldReference: string): string {
    const driver = this.dbProvider.driver;

    if (driver === DriverClient.Pg) {
      return `json_agg(${fieldReference})`;
    } else if (driver === DriverClient.Sqlite) {
      return `json_group_array(${fieldReference})`;
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  // Field visitor methods - most fields don't need CTEs
  visitNumberField(field: NumberFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitSingleLineTextField(field: SingleLineTextFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitLongTextField(field: LongTextFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitAttachmentField(field: AttachmentFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitCheckboxField(field: CheckboxFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitDateField(field: DateFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitRatingField(field: RatingFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitAutoNumberField(field: AutoNumberFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitLinkField(field: LinkFieldCore): ICteResult {
    // Check if this is a Lookup field first
    if (field.isLookup) {
      return this.checkAndGenerateLookupCte(field);
    }

    // For non-Lookup Link fields, use the new foreign table CTE approach
    const options = field.options as ILinkFieldOptions;
    return this.generateForeignTableCte(options.foreignTableId);
  }

  visitRollupField(field: RollupFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitSingleSelectField(field: SingleSelectFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitMultipleSelectField(field: MultipleSelectFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitFormulaField(field: FormulaFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitCreatedTimeField(field: CreatedTimeFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitUserField(field: UserFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitCreatedByField(field: CreatedByFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }

  visitLastModifiedByField(field: LastModifiedByFieldCore): ICteResult {
    return this.checkAndGenerateLookupCte(field);
  }
}
