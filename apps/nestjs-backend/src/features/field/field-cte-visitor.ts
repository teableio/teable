import { Logger } from '@nestjs/common';
import type {
  ILinkFieldOptions,
  ILookupOptionsVo,
  IFieldVisitor,
  IRollupFieldOptions,
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
import { FieldType, DriverClient, Relationship } from '@teable/core';
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
      // For lookup fields, we no longer generate separate CTEs
      // They will get their data from the corresponding link field CTE
      // The link field CTE should already be generated when processing link fields
      return { hasChanges: false };
    }
    return { hasChanges: false };
  }

  /**
   * Generate CTE for a single Link field
   */
  private generateLinkFieldCte(field: LinkFieldCore): ICteResult {
    const options = field.options as ILinkFieldOptions;
    const { foreignTableId } = options;

    // Get foreign table name from context
    const foreignTableName = this.context.tableNameMap.get(foreignTableId);
    if (!foreignTableName) {
      this.logger.debug(`Foreign table not found: ${foreignTableId}`);
      return { hasChanges: false };
    }

    // Get lookup field for the link field
    const linkLookupField = this.context.fieldMap.get(options.lookupFieldId);
    if (!linkLookupField) {
      this.logger.debug(`Lookup field not found: ${options.lookupFieldId}`);
      return { hasChanges: false };
    }

    const cteName = `cte_${field.id}`;
    const { mainTableName } = this.context;

    // Create CTE callback function
    // eslint-disable-next-line sonarjs/cognitive-complexity
    const cteCallback = (qb: Knex.QueryBuilder) => {
      const mainAlias = 'm';
      const junctionAlias = 'j';
      const foreignAlias = 'f';

      // Build select columns
      const selectColumns = [`${mainAlias}.__id as main_record_id`];

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

      const jsonAggFunction = this.getLinkJsonAggregationFunction(foreignAlias, fieldExpression);
      selectColumns.push(qb.client.raw(`${jsonAggFunction} as link_value`));

      // Add lookup field selections for fields that reference this link field
      const lookupFields = this.collectLookupFieldsForLinkField(field.id);
      for (const lookupField of lookupFields) {
        const targetField = this.context.fieldMap.get(lookupField.lookupOptions!.lookupFieldId);
        if (targetField) {
          // Create FieldSelectVisitor with table alias
          const tempQb2 = qb.client.queryBuilder();
          const fieldSelectVisitor2 = new FieldSelectVisitor(
            tempQb2,
            this.dbProvider,
            { fieldMap: this.context.fieldMap },
            undefined, // No fieldCteMap to prevent recursive Lookup processing
            foreignAlias
          );

          // Use the visitor to get the correct field selection
          const fieldResult2 = targetField.accept(fieldSelectVisitor2);
          const fieldExpression2 =
            typeof fieldResult2 === 'string' ? fieldResult2 : fieldResult2.toSQL().sql;

          if (lookupField.isMultipleCellValue) {
            const jsonAggFunction2 = this.getJsonAggregationFunction(fieldExpression2);
            selectColumns.push(qb.client.raw(`${jsonAggFunction2} as "lookup_${lookupField.id}"`));
          } else {
            selectColumns.push(qb.client.raw(`${fieldExpression2} as "lookup_${lookupField.id}"`));
          }
        }
      }

      // Add rollup field selections for fields that reference this link field
      const rollupFields = this.collectRollupFieldsForLinkField(field.id);
      for (const rollupField of rollupFields) {
        const targetField = this.context.fieldMap.get(rollupField.lookupOptions!.lookupFieldId);
        if (targetField) {
          // Create FieldSelectVisitor with table alias
          const tempQb3 = qb.client.queryBuilder();
          const fieldSelectVisitor3 = new FieldSelectVisitor(
            tempQb3,
            this.dbProvider,
            { fieldMap: this.context.fieldMap },
            undefined, // No fieldCteMap to prevent recursive processing
            foreignAlias
          );

          // Use the visitor to get the correct field selection
          const fieldResult3 = targetField.accept(fieldSelectVisitor3);
          const fieldExpression3 =
            typeof fieldResult3 === 'string' ? fieldResult3 : fieldResult3.toSQL().sql;

          // Generate rollup aggregation expression
          const rollupOptions = rollupField.options as IRollupFieldOptions;
          const rollupAggregation = this.generateRollupAggregation(
            rollupOptions.expression,
            fieldExpression3
          );
          selectColumns.push(qb.client.raw(`${rollupAggregation} as "rollup_${rollupField.id}"`));
        }
      }

      // Get JOIN information from the field options
      const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

      // Build query based on relationship type
      if (relationship === Relationship.ManyMany || relationship === Relationship.OneMany) {
        // Use junction table for many-to-many and one-to-many relationships
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
      } else if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
        // Direct join for many-to-one and one-to-one relationships
        qb.select(selectColumns)
          .from(`${mainTableName} as ${mainAlias}`)
          .leftJoin(
            `${foreignTableName} as ${foreignAlias}`,
            `${mainAlias}.${foreignKeyName}`,
            `${foreignAlias}.__id`
          )
          .groupBy(`${mainAlias}.__id`);
      }
    };

    this.logger.debug(`Generated link field CTE for ${field.id} with name ${cteName}`);

    return { cteName, hasChanges: true, cteCallback };
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
   * Collect all Lookup fields that reference a specific Link field
   */
  private collectLookupFieldsForLinkField(linkFieldId: string): IFieldInstance[] {
    const lookupFields: IFieldInstance[] = [];
    for (const [, field] of this.context.fieldMap) {
      if (
        field.isLookup &&
        field.lookupOptions &&
        field.lookupOptions.linkFieldId === linkFieldId
      ) {
        lookupFields.push(field);
      }
    }
    return lookupFields;
  }

  /**
   * Collect all Rollup fields that reference a specific Link field
   */
  private collectRollupFieldsForLinkField(linkFieldId: string): IFieldInstance[] {
    const rollupFields: IFieldInstance[] = [];
    for (const [, field] of this.context.fieldMap) {
      if (
        field.type === FieldType.Rollup &&
        field.lookupOptions &&
        field.lookupOptions.linkFieldId === linkFieldId
      ) {
        rollupFields.push(field);
      }
    }
    return rollupFields;
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

  /**
   * Generate rollup aggregation expression based on rollup function
   */
  private generateRollupAggregation(expression: string, fieldExpression: string): string {
    // Parse the rollup function from expression like 'sum({values})'
    const functionMatch = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!functionMatch) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }

    const functionName = functionMatch[1].toLowerCase();

    switch (functionName) {
      case 'sum':
        return `SUM(${fieldExpression})`;
      case 'count':
        return `COUNT(${fieldExpression})`;
      case 'countall':
        return `COUNT(*)`;
      case 'counta':
        return `COUNT(${fieldExpression})`;
      case 'max':
        return `MAX(${fieldExpression})`;
      case 'min':
        return `MIN(${fieldExpression})`;
      case 'and':
        // For boolean AND, all values must be true (non-zero/non-null)
        return this.dbProvider.driver === DriverClient.Pg
          ? `BOOL_AND(${fieldExpression}::boolean)`
          : `MIN(${fieldExpression})`;
      case 'or':
        // For boolean OR, at least one value must be true
        return this.dbProvider.driver === DriverClient.Pg
          ? `BOOL_OR(${fieldExpression}::boolean)`
          : `MAX(${fieldExpression})`;
      case 'xor':
        // XOR is more complex, we'll use a custom expression
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COUNT(CASE WHEN ${fieldExpression}::boolean THEN 1 END) % 2 = 1)`
          : `(COUNT(CASE WHEN ${fieldExpression} THEN 1 END) % 2 = 1)`;
      case 'array_join':
      case 'concatenate':
        // Join all values into a single string
        return this.dbProvider.driver === DriverClient.Pg
          ? `STRING_AGG(${fieldExpression}::text, ', ')`
          : `GROUP_CONCAT(${fieldExpression}, ', ')`;
      case 'array_unique':
        // Get unique values as JSON array
        return this.dbProvider.driver === DriverClient.Pg
          ? `json_agg(DISTINCT ${fieldExpression})`
          : `json_group_array(DISTINCT ${fieldExpression})`;
      case 'array_compact':
        // Get non-null values as JSON array
        return this.dbProvider.driver === DriverClient.Pg
          ? `json_agg(${fieldExpression}) FILTER (WHERE ${fieldExpression} IS NOT NULL)`
          : `json_group_array(${fieldExpression}) WHERE ${fieldExpression} IS NOT NULL`;
      default:
        throw new Error(`Unsupported rollup function: ${functionName}`);
    }
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

    // For non-Lookup Link fields, generate individual CTE for each field
    return this.generateLinkFieldCte(field);
  }

  visitRollupField(_field: RollupFieldCore): ICteResult {
    // Rollup fields don't need their own CTE, they use the link field's CTE
    return { hasChanges: false };
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
