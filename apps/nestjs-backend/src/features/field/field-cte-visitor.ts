/* eslint-disable sonarjs/no-duplicated-branches */
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
  ButtonFieldCore,
  ICurrencyFormatting,
} from '@teable/core';
import { FieldType, DriverClient, Relationship, NumberFormattingType } from '@teable/core';
import type { Knex } from 'knex';
import { match, P } from 'ts-pattern';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import type { LinkFieldDto } from '../../features/field/model/field-dto/link-field.dto';

import { FieldSelectVisitor } from './field-select-visitor';
import type { IFieldInstance } from './model/factory';

/**
 * Field formatting visitor that converts field cellValue2String logic to SQL expressions
 */
class FieldFormattingVisitor implements IFieldVisitor<string> {
  constructor(
    private readonly fieldExpression: string,
    private readonly driver: DriverClient
  ) {}

  private get isPostgreSQL(): boolean {
    return this.driver === DriverClient.Pg;
  }

  /**
   * Convert field expression to text/string format for database-specific SQL
   */
  private convertToText(): string {
    if (this.isPostgreSQL) {
      return `${this.fieldExpression}::TEXT`;
    } else {
      return `CAST(${this.fieldExpression} AS TEXT)`;
    }
  }

  visitSingleLineTextField(_field: SingleLineTextFieldCore): string {
    // Text fields don't need special formatting, return as-is
    return this.fieldExpression;
  }

  visitLongTextField(_field: LongTextFieldCore): string {
    // Text fields don't need special formatting, return as-is
    return this.fieldExpression;
  }

  visitNumberField(field: NumberFieldCore): string {
    const formatting = field.options.formatting;
    const { type, precision } = formatting;

    return match({ type, precision, isPostgreSQL: this.isPostgreSQL })
      .with(
        { type: NumberFormattingType.Decimal, precision: P.number },
        ({ precision, isPostgreSQL }) =>
          isPostgreSQL
            ? `ROUND(CAST(${this.fieldExpression} AS NUMERIC), ${precision})::TEXT`
            : `PRINTF('%.${precision}f', ${this.fieldExpression})`
      )
      .with(
        { type: NumberFormattingType.Percent, precision: P.number },
        ({ precision, isPostgreSQL }) =>
          isPostgreSQL
            ? `ROUND(CAST(${this.fieldExpression} * 100 AS NUMERIC), ${precision})::TEXT || '%'`
            : `PRINTF('%.${precision}f', ${this.fieldExpression} * 100) || '%'`
      )
      .with({ type: NumberFormattingType.Currency }, ({ precision, isPostgreSQL }) => {
        const symbol = (formatting as ICurrencyFormatting).symbol || '$';
        return match({ precision, isPostgreSQL })
          .with(
            { precision: P.number, isPostgreSQL: true },
            ({ precision }) =>
              `'${symbol}' || ROUND(CAST(${this.fieldExpression} AS NUMERIC), ${precision})::TEXT`
          )
          .with(
            { precision: P.number, isPostgreSQL: false },
            ({ precision }) => `'${symbol}' || PRINTF('%.${precision}f', ${this.fieldExpression})`
          )
          .with({ isPostgreSQL: true }, () => `'${symbol}' || ${this.fieldExpression}::TEXT`)
          .with(
            { isPostgreSQL: false },
            () => `'${symbol}' || CAST(${this.fieldExpression} AS TEXT)`
          )
          .exhaustive();
      })
      .otherwise(({ isPostgreSQL }) =>
        // Default: convert to string
        isPostgreSQL ? `${this.fieldExpression}::TEXT` : `CAST(${this.fieldExpression} AS TEXT)`
      );
  }

  visitCheckboxField(_field: CheckboxFieldCore): string {
    // Checkbox fields are stored as boolean, convert to string
    return this.convertToText();
  }

  visitDateField(_field: DateFieldCore): string {
    // Date fields are stored as ISO strings, return as-is
    return this.fieldExpression;
  }

  visitRatingField(_field: RatingFieldCore): string {
    // Rating fields are numbers, convert to string
    return this.convertToText();
  }

  visitAutoNumberField(_field: AutoNumberFieldCore): string {
    // Auto number fields are numbers, convert to string
    return this.convertToText();
  }

  visitSingleSelectField(_field: SingleSelectFieldCore): string {
    // Select fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitMultipleSelectField(_field: MultipleSelectFieldCore): string {
    // Multiple select fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitAttachmentField(_field: AttachmentFieldCore): string {
    // Attachment fields are complex, for now return as-is
    return this.fieldExpression;
  }

  visitLinkField(_field: LinkFieldCore): string {
    // Link fields should not be formatted directly, return as-is
    return this.fieldExpression;
  }

  visitRollupField(_field: RollupFieldCore): string {
    // Rollup fields depend on their result type, for now return as-is
    return this.fieldExpression;
  }

  visitFormulaField(_field: FormulaFieldCore): string {
    // Formula fields depend on their result type, for now return as-is
    return this.fieldExpression;
  }

  visitCreatedTimeField(_field: CreatedTimeFieldCore): string {
    // Created time fields are stored as ISO strings, return as-is
    return this.fieldExpression;
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): string {
    // Last modified time fields are stored as ISO strings, return as-is
    return this.fieldExpression;
  }

  visitUserField(_field: UserFieldCore): string {
    // User fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitCreatedByField(_field: CreatedByFieldCore): string {
    // Created by fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitLastModifiedByField(_field: LastModifiedByFieldCore): string {
    // Last modified by fields are stored as strings, return as-is
    return this.fieldExpression;
  }

  visitButtonField(_field: ButtonFieldCore): string {
    // Button fields don't have values, return as-is
    return this.fieldExpression;
  }
}

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

export interface ILookupChainStep {
  field: IFieldInstance;
  linkField: IFieldInstance;
  foreignTableId: string;
  foreignTableName: string;
  junctionInfo: {
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
  };
}

export interface ILookupChain {
  steps: ILookupChainStep[];
  finalField: IFieldInstance;
  finalTableName: string;
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

  constructor(
    private readonly dbProvider: IDbProvider,
    private readonly context: IFieldCteContext
  ) {}

  /**
   * Generate JSON aggregation function for Link fields (creates objects with id and title)
   * When title is null, only includes the id key
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private getLinkJsonAggregationFunction(
    tableAlias: string,
    fieldExpression: string,
    targetLookupField?: IFieldInstance,
    junctionAlias?: string,
    field?: LinkFieldCore
  ): string {
    const driver = this.dbProvider.driver;

    // Use table alias for cleaner SQL
    const recordIdRef = `${tableAlias}."__id"`;

    // Apply field formatting if targetLookupField is provided
    let titleRef = fieldExpression;
    if (targetLookupField) {
      const formattingVisitor = new FieldFormattingVisitor(fieldExpression, driver);
      titleRef = targetLookupField.accept(formattingVisitor);
    }

    // Determine if this relationship should return multiple values (array) or single value (object)
    const relationship = field?.options.relationship;
    const isMultiValue =
      relationship === Relationship.ManyMany || relationship === Relationship.OneMany;

    if (driver === DriverClient.Pg) {
      // Use jsonb_strip_nulls to automatically remove null title keys
      const conditionalJsonObject = `jsonb_strip_nulls(jsonb_build_object('id', ${recordIdRef}, 'title', ${titleRef}))::json`;

      if (isMultiValue) {
        // Filter out null records and return empty array if no valid records exist
        // Order by junction table __id if available (for consistent insertion order)
        // For relationships without junction table, use the order column if field has order column
        let orderByField: string;
        if (junctionAlias && junctionAlias.trim()) {
          // ManyMany relationship: use junction table order column if available, otherwise __id
          if (field && field.getHasOrderColumn()) {
            const linkField = field as LinkFieldDto;
            orderByField = `${junctionAlias}."${linkField.getOrderColumnName()}"`;
          } else {
            orderByField = `${junctionAlias}."__id"`;
          }
        } else if (field && field.getHasOrderColumn()) {
          // OneMany/ManyOne/OneOne relationship: use the order column in the foreign key table
          const linkField = field as LinkFieldDto;
          orderByField = `${tableAlias}."${linkField.getOrderColumnName()}"`;
        } else {
          // Fallback to record ID if no order column is available
          orderByField = recordIdRef;
        }
        return `COALESCE(json_agg(${conditionalJsonObject} ORDER BY ${orderByField}) FILTER (WHERE ${recordIdRef} IS NOT NULL), '[]'::json)`;
      } else {
        // For single value relationships (ManyOne, OneOne), return single object or null
        return `CASE WHEN ${recordIdRef} IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
      }
    } else if (driver === DriverClient.Sqlite) {
      // Create conditional JSON object that only includes title if it's not null
      const conditionalJsonObject = `CASE
        WHEN ${titleRef} IS NOT NULL THEN json_object('id', ${recordIdRef}, 'title', ${titleRef})
        ELSE json_object('id', ${recordIdRef})
      END`;

      if (isMultiValue) {
        // For SQLite, we need to handle null filtering differently
        // Note: SQLite's json_group_array doesn't support ORDER BY, so ordering must be handled at query level
        return `CASE WHEN COUNT(${recordIdRef}) > 0 THEN json_group_array(${conditionalJsonObject}) ELSE '[]' END`;
      } else {
        // For single value relationships, return single object or null
        return `CASE WHEN ${recordIdRef} IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
      }
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  /**
   * Check if field is a Lookup field and generate CTE if needed
   */
  private checkAndGenerateLookupCte(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    hasError?: boolean;
    id: string;
  }): ICteResult {
    if (field.isLookup && field.lookupOptions) {
      // Check if the field has error (e.g., target field deleted)
      if (field.hasError) {
        this.logger.warn(`Lookup field ${field.id} has error, skipping CTE generation`);
        return { hasChanges: false };
      }

      // Check if the target lookup field exists
      const targetField = this.context.fieldMap.get(field.lookupOptions.lookupFieldId);
      if (!targetField) {
        // Target field has been deleted, skip CTE generation
        this.logger.warn(
          `Lookup field ${field.id} references deleted field ${field.lookupOptions.lookupFieldId}, skipping CTE generation`
        );
        return { hasChanges: false };
      }

      // Check if this is a nested lookup field (lookup -> lookup)
      if (this.isNestedLookup(field)) {
        return this.generateNestedLookupCte(field);
      }

      // Check if this is a lookup to link field (lookup -> link)
      if (targetField.type === FieldType.Link && !targetField.isLookup) {
        return this.generateLookupToLinkCte(field);
      }

      // For regular lookup fields, they will get their data from the corresponding link field CTE
      // The link field CTE should already be generated when processing link fields
      return { hasChanges: false };
    }
    return { hasChanges: false };
  }

  /**
   * Check if a lookup field is nested (lookup -> lookup)
   */
  private isNestedLookup(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    id: string;
  }): boolean {
    if (!field.isLookup || !field.lookupOptions) {
      return false;
    }

    // Get the target field that this lookup field is looking up
    const targetField = this.context.fieldMap.get(field.lookupOptions.lookupFieldId);

    // If target field doesn't exist (deleted), this is not a nested lookup
    if (!targetField) {
      return false;
    }

    // If the target field is also a lookup field, then this is a nested lookup
    return targetField.isLookup === true;
  }

  /**
   * Check if a lookup field targets a link field (lookup -> link)
   */
  private isLookupToLink(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    id: string;
  }): boolean {
    if (!field.isLookup || !field.lookupOptions) {
      return false;
    }

    // Get the target field that this lookup field is looking up
    const targetField = this.context.fieldMap.get(field.lookupOptions.lookupFieldId);

    // If target field doesn't exist (deleted), this is not a lookup to link
    if (!targetField) {
      return false;
    }

    // If the target field is a link field (and not a lookup field), then this is a lookup to link
    const isLookupToLink = targetField.type === FieldType.Link && !targetField.isLookup;

    this.logger.warn(
      `[DEBUG] Checking lookup to link for field ${field.id}: target field ${field.lookupOptions.lookupFieldId} type=${targetField.type}, isLookup=${targetField.isLookup}, result=${isLookupToLink}`
    );

    return isLookupToLink;
  }

  /**
   * Generate CTE for nested lookup fields (lookup -> lookup -> ... -> field)
   */
  private generateNestedLookupCte(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    id: string;
  }): ICteResult {
    if (!field.isLookup || !field.lookupOptions) {
      return { hasChanges: false };
    }

    try {
      // Build the lookup chain
      const chain = this.buildLookupChain(field);
      if (chain.steps.length === 0) {
        return { hasChanges: false };
      }

      const cteName = `cte_nested_lookup_${field.id}`;
      const { mainTableName } = this.context;

      // Create CTE callback function
      const cteCallback = (qb: Knex.QueryBuilder) => {
        this.buildNestedLookupQuery(qb, chain, mainTableName, field.id);
      };

      return { cteName, hasChanges: true, cteCallback };
    } catch (error) {
      this.logger.error(`Failed to generate nested lookup CTE for ${field.id}:`, error);
      return { hasChanges: false };
    }
  }

  /**
   * Generate CTE for lookup fields that target link fields (lookup -> link)
   * This creates a specialized CTE that handles the lookup -> link relationship
   */
  private generateLookupToLinkCte(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    id: string;
  }): ICteResult {
    if (!field.isLookup || !field.lookupOptions) {
      return { hasChanges: false };
    }

    const { lookupOptions } = field;
    const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;

    // Get the link field that this lookup field is targeting
    const linkField = this.context.fieldMap.get(linkFieldId);
    if (!linkField || linkField.type !== FieldType.Link) {
      return { hasChanges: false };
    }

    // Get the target field in the foreign table that we want to lookup
    // This should be the link field that we're looking up
    const targetLinkField = this.context.fieldMap.get(lookupFieldId);
    if (!targetLinkField || targetLinkField.type !== FieldType.Link) {
      return { hasChanges: false };
    }

    // Get the link field's lookup field (the field that the link field displays)
    const targetLinkOptions = targetLinkField.options as ILinkFieldOptions;
    const linkLookupField = this.context.fieldMap.get(targetLinkOptions.lookupFieldId);
    if (!linkLookupField) {
      return { hasChanges: false };
    }

    // Get foreign table name from context
    const foreignTableName = this.context.tableNameMap.get(foreignTableId);
    if (!foreignTableName) {
      return { hasChanges: false };
    }

    // Get target link field options to understand the relationship structure
    const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = targetLinkOptions;

    const cteName = `cte_lookup_to_link_${field.id}`;
    const { mainTableName } = this.context;

    // Create CTE callback function
    // eslint-disable-next-line sonarjs/cognitive-complexity
    const cteCallback = (qb: Knex.QueryBuilder) => {
      const mainAlias = 'm';
      const junctionAlias = 'j';
      const foreignAlias = 'f';
      const linkTargetAlias = 'lt'; // alias for the table that link field points to

      // Build select columns
      const selectColumns = [`${mainAlias}.__id as main_record_id`];

      // Create FieldSelectVisitor to get the correct field expression for the target field, without alias
      const tempQb = qb.client.queryBuilder();
      const fieldSelectVisitor = new FieldSelectVisitor(
        tempQb,
        this.dbProvider,
        { fieldMap: this.context.fieldMap },
        undefined, // No fieldCteMap to prevent recursive processing
        linkTargetAlias,
        false // withAlias = false for use in jsonb_build_object
      );

      // Get the field expression for the link lookup field
      const fieldResult = linkLookupField.accept(fieldSelectVisitor);
      const fieldExpression =
        typeof fieldResult === 'string' ? fieldResult : fieldResult.toSQL().sql;

      // Generate JSON expression based on the TARGET LINK field's relationship (not the lookup field's relationship)
      const targetLinkRelationship = relationship as Relationship;
      let jsonExpression: string;

      if (
        targetLinkRelationship === Relationship.ManyMany ||
        targetLinkRelationship === Relationship.OneMany
      ) {
        // For multi-value relationships, use aggregation
        const jsonAggFunction = this.getLinkJsonAggregationFunction(
          linkTargetAlias,
          fieldExpression,
          linkLookupField,
          'j2', // Junction table alias for ordering,
          targetLinkField
        );
        jsonExpression = jsonAggFunction;
      } else {
        // For single-value relationships, apply formatting and use conditional JSON object
        const driver = this.dbProvider.driver;
        let formattedFieldExpression = fieldExpression;
        if (linkLookupField) {
          const formattingVisitor = new FieldFormattingVisitor(fieldExpression, driver);
          formattedFieldExpression = linkLookupField.accept(formattingVisitor);
        }

        if (driver === DriverClient.Pg) {
          const conditionalJsonObject = `jsonb_strip_nulls(jsonb_build_object('id', ${linkTargetAlias}.__id, 'title', ${formattedFieldExpression}))::json`;
          jsonExpression = `CASE WHEN ${linkTargetAlias}.__id IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
        } else {
          // SQLite
          const conditionalJsonObject = `CASE
            WHEN ${formattedFieldExpression} IS NOT NULL THEN json_object('id', ${linkTargetAlias}.__id, 'title', ${formattedFieldExpression})
            ELSE json_object('id', ${linkTargetAlias}.__id)
          END`;
          jsonExpression = `CASE WHEN ${linkTargetAlias}.__id IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
        }
      }

      selectColumns.push(qb.client.raw(`${jsonExpression} as lookup_link_value`));

      // Get the target table name for the link field
      const linkTargetTableName = this.context.tableNameMap.get(targetLinkOptions.foreignTableId);
      if (!linkTargetTableName) {
        return;
      }

      // Build the query - we need to join through the lookup relationship first, then through the link relationship
      let query = qb
        .select(selectColumns)
        .from(`${mainTableName} as ${mainAlias}`)
        // First join: main table to lookup's junction table (using lookup field's relationship info)
        .leftJoin(
          `${lookupOptions.fkHostTableName} as ${junctionAlias}`,
          `${mainAlias}.__id`,
          `${junctionAlias}.${lookupOptions.selfKeyName}`
        )
        // Second join: lookup's junction table to foreign table (where the link field is located)
        .leftJoin(
          `${foreignTableName} as ${foreignAlias}`,
          `${junctionAlias}.${lookupOptions.foreignKeyName}`,
          `${foreignAlias}.__id`
        );

      // Now handle the link field's relationship to its target table
      if (relationship === Relationship.ManyMany || relationship === Relationship.OneMany) {
        // Link field uses junction table
        query = query
          .leftJoin(`${fkHostTableName} as j2`, `${foreignAlias}.__id`, `j2.${selfKeyName}`)
          .leftJoin(
            `${linkTargetTableName} as ${linkTargetAlias}`,
            `j2.${foreignKeyName}`,
            `${linkTargetAlias}.__id`
          );
      } else if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
        // Link field uses direct foreign key
        query = query.leftJoin(
          `${linkTargetTableName} as ${linkTargetAlias}`,
          `${foreignAlias}.${foreignKeyName}`,
          `${linkTargetAlias}.__id`
        );
      }

      // Only add GROUP BY when using aggregation (for multi-value relationships)
      if (
        targetLinkRelationship === Relationship.ManyMany ||
        targetLinkRelationship === Relationship.OneMany
      ) {
        query.groupBy(`${mainAlias}.__id`);
      }
    };

    return { cteName, hasChanges: true, cteCallback };
  }

  /**
   * Build lookup chain for nested lookup fields
   */
  private buildLookupChain(field: {
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsVo;
    id: string;
  }): ILookupChain {
    const steps: ILookupChainStep[] = [];
    const visitedFields = new Set<string>(); // Prevent circular references

    let currentField = field;

    while (currentField.isLookup && currentField.lookupOptions) {
      // Prevent circular references
      if (visitedFields.has(currentField.id)) {
        this.logger.warn(
          `Circular reference detected in lookup chain for field: ${currentField.id}`
        );
        break;
      }
      visitedFields.add(currentField.id);

      const { lookupOptions } = currentField;
      const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;

      // Get link field
      const linkField = this.context.fieldMap.get(linkFieldId);
      if (!linkField) {
        break;
      }

      // Get foreign table name
      const foreignTableName = this.context.tableNameMap.get(foreignTableId);
      if (!foreignTableName) {
        break;
      }

      // Add step to chain
      steps.push({
        field: currentField as IFieldInstance,
        linkField,
        foreignTableId,
        foreignTableName,
        junctionInfo: {
          fkHostTableName: lookupOptions.fkHostTableName!,
          selfKeyName: lookupOptions.selfKeyName!,
          foreignKeyName: lookupOptions.foreignKeyName!,
        },
      });

      // Move to the next field in the chain
      const nextField = this.context.fieldMap.get(lookupFieldId);
      if (!nextField) {
        break;
      }

      // If the next field is not a lookup field, we've reached the end
      if (!nextField.isLookup) {
        const finalTableName = this.context.tableNameMap.get(foreignTableId);
        return {
          steps,
          finalField: nextField,
          finalTableName: finalTableName || '',
        };
      }

      currentField = nextField;
    }

    // If we exit the loop without finding a final non-lookup field, return empty chain
    return { steps: [], finalField: {} as IFieldInstance, finalTableName: '' };
  }

  /**
   * Build the nested lookup query with multiple JOINs
   */
  private buildNestedLookupQuery(
    qb: Knex.QueryBuilder,
    chain: ILookupChain,
    mainTableName: string,
    _fieldId: string
  ): void {
    if (chain.steps.length === 0) {
      return;
    }

    // Generate aliases for each step
    const mainAlias = `m${chain.steps.length}`;
    const aliases = chain.steps.map((_, index) => ({
      junction: `j${index + 1}`,
      table: `m${index}`,
    }));
    const finalAlias = 'f1';

    // Build select columns
    const selectColumns = [`${mainAlias}.__id as main_record_id`];

    // Get the final field expression using the database field name
    const fieldExpression = `${finalAlias}."${chain.finalField.dbFieldName}"`;

    // Add aggregation for the final field
    const jsonAggFunction = this.getJsonAggregationFunction(fieldExpression);
    selectColumns.push(qb.client.raw(`${jsonAggFunction} as "nested_lookup_value"`));

    // Start building the query from main table
    let query = qb.select(selectColumns).from(`${mainTableName} as ${mainAlias}`);

    // Add JOINs for each step in the chain
    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      const alias = aliases[i];

      if (i === 0) {
        // First JOIN: from main table to first junction table
        query = query.leftJoin(
          `${step.junctionInfo.fkHostTableName} as ${alias.junction}`,
          `${mainAlias}.__id`,
          `${alias.junction}.${step.junctionInfo.selfKeyName}`
        );
      } else {
        // Subsequent JOINs: from previous table to current junction table
        const prevAlias = aliases[i - 1];
        query = query.leftJoin(
          `${step.junctionInfo.fkHostTableName} as ${alias.junction}`,
          `${prevAlias.table}.__id`,
          `${alias.junction}.${step.junctionInfo.selfKeyName}`
        );
      }

      // JOIN from junction table to target table
      if (i === chain.steps.length - 1) {
        // Last step: join to final table
        query = query.leftJoin(
          `${chain.finalTableName} as ${finalAlias}`,
          `${alias.junction}.${step.junctionInfo.foreignKeyName}`,
          `${finalAlias}.__id`
        );
      } else {
        // Intermediate step: join to intermediate table
        query = query.leftJoin(
          `${step.foreignTableName} as ${alias.table}`,
          `${alias.junction}.${step.junctionInfo.foreignKeyName}`,
          `${alias.table}.__id`
        );
      }
    }

    // Add GROUP BY for aggregation
    query.groupBy(`${mainAlias}.__id`);
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
      return { hasChanges: false };
    }

    // Get lookup field for the link field
    const linkLookupField = this.context.fieldMap.get(options.lookupFieldId);
    if (!linkLookupField) {
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

      // Create FieldSelectVisitor with table alias, without alias for use in jsonb_build_object
      const tempQb = qb.client.queryBuilder();
      const fieldSelectVisitor = new FieldSelectVisitor(
        tempQb,
        this.dbProvider,
        { fieldMap: this.context.fieldMap },
        undefined, // No fieldCteMap to prevent recursive Lookup processing
        foreignAlias,
        false // withAlias = false for use in jsonb_build_object
      );

      // Use the visitor to get the correct field selection
      const fieldResult = linkLookupField.accept(fieldSelectVisitor);
      const fieldExpression =
        typeof fieldResult === 'string' ? fieldResult : fieldResult.toSQL().sql;

      // Determine if this relationship uses junction table
      const usesJunctionTable =
        options.relationship === Relationship.ManyMany ||
        (options.relationship === Relationship.OneMany && options.isOneWay);

      const jsonAggFunction = this.getLinkJsonAggregationFunction(
        foreignAlias,
        fieldExpression,
        linkLookupField,
        usesJunctionTable ? junctionAlias : undefined, // Pass junction alias if using junction table
        field
      );
      selectColumns.push(qb.client.raw(`${jsonAggFunction} as link_value`));

      // Add lookup field selections for fields that reference this link field
      const lookupFields = this.collectLookupFieldsForLinkField(field.id);
      for (const lookupField of lookupFields) {
        // Skip lookup field if it has error
        if (lookupField.hasError) {
          this.logger.warn(`Lookup field ${lookupField.id} has error, skipping lookup selection`);
          continue;
        }

        const targetField = this.context.fieldMap.get(lookupField.lookupOptions!.lookupFieldId);
        if (targetField) {
          // Create FieldSelectVisitor with table alias, without alias for use in jsonb_build_object
          const tempQb2 = qb.client.queryBuilder();
          const fieldSelectVisitor2 = new FieldSelectVisitor(
            tempQb2,
            this.dbProvider,
            { fieldMap: this.context.fieldMap },
            undefined, // No fieldCteMap to prevent recursive Lookup processing
            foreignAlias,
            false // withAlias = false for use in jsonb_build_object
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
        // Skip rollup field if it has error
        if (rollupField.hasError) {
          this.logger.warn(`Rollup field ${rollupField.id} has error, skipping rollup aggregation`);
          continue;
        }

        const targetField = this.context.fieldMap.get(rollupField.lookupOptions!.lookupFieldId);
        if (targetField) {
          // Create FieldSelectVisitor with table alias, without alias for use in aggregation
          const tempQb3 = qb.client.queryBuilder();
          const fieldSelectVisitor3 = new FieldSelectVisitor(
            tempQb3,
            this.dbProvider,
            { fieldMap: this.context.fieldMap },
            undefined, // No fieldCteMap to prevent recursive processing
            foreignAlias,
            false // withAlias = false for use in aggregation functions
          );

          // Use the visitor to get the correct field selection
          const fieldResult3 = targetField.accept(fieldSelectVisitor3);
          const fieldExpression3 =
            typeof fieldResult3 === 'string' ? fieldResult3 : fieldResult3.toSQL().sql;

          // Generate rollup aggregation expression
          const rollupOptions = rollupField.options as IRollupFieldOptions;
          const isSingleValueRelationship =
            options.relationship === Relationship.ManyOne ||
            options.relationship === Relationship.OneOne;
          const rollupAggregation = isSingleValueRelationship
            ? this.generateSingleValueRollupAggregation(rollupOptions.expression, fieldExpression3)
            : this.generateRollupAggregation(
                rollupOptions.expression,
                fieldExpression3,
                targetField,
                junctionAlias
              );
          selectColumns.push(qb.client.raw(`${rollupAggregation} as "rollup_${rollupField.id}"`));
        }
      }

      // Get JOIN information from the field options
      const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

      // Build query based on relationship type and whether it uses junction table

      if (usesJunctionTable) {
        // Use junction table for many-to-many relationships and one-way one-to-many relationships
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

        // For SQLite, add ORDER BY at query level since json_group_array doesn't support internal ordering
        if (this.dbProvider.driver === DriverClient.Sqlite) {
          qb.orderBy(`${junctionAlias}.__id`);
        }
      } else if (relationship === Relationship.OneMany) {
        // For non-one-way OneMany relationships, foreign key is stored in the foreign table
        // No junction table needed
        qb.select(selectColumns)
          .from(`${mainTableName} as ${mainAlias}`)
          .leftJoin(
            `${foreignTableName} as ${foreignAlias}`,
            `${mainAlias}.__id`,
            `${foreignAlias}.${selfKeyName}`
          )
          .groupBy(`${mainAlias}.__id`);

        // For SQLite, add ORDER BY at query level
        if (this.dbProvider.driver === DriverClient.Sqlite) {
          if (field.getHasOrderColumn()) {
            qb.orderBy(`${foreignAlias}.${selfKeyName}_order`);
          } else {
            qb.orderBy(`${foreignAlias}.__id`);
          }
        }
      } else if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
        // Direct join for many-to-one and one-to-one relationships
        // No GROUP BY needed for single-value relationships

        // For OneOne and ManyOne relationships, the foreign key is always stored in fkHostTableName
        // But we need to determine the correct join condition based on which table we're querying from
        const isForeignKeyInMainTable = fkHostTableName === mainTableName;

        qb.select(selectColumns).from(`${mainTableName} as ${mainAlias}`);

        if (isForeignKeyInMainTable) {
          // Foreign key is stored in the main table (original field case)
          // Join: main_table.foreign_key_column = foreign_table.__id
          qb.leftJoin(
            `${foreignTableName} as ${foreignAlias}`,
            `${mainAlias}.${foreignKeyName}`,
            `${foreignAlias}.__id`
          );
        } else {
          // Foreign key is stored in the foreign table (symmetric field case)
          // Join: foreign_table.foreign_key_column = main_table.__id
          // Note: for symmetric fields, selfKeyName and foreignKeyName are swapped
          qb.leftJoin(
            `${foreignTableName} as ${foreignAlias}`,
            `${foreignAlias}.${selfKeyName}`,
            `${mainAlias}.__id`
          );
        }
      }
    };

    return { cteName, hasChanges: true, cteCallback };
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
        // Skip nested lookup fields and lookup to link fields as they have their own dedicated CTE
        if (this.isNestedLookup(field) || this.isLookupToLink(field)) {
          continue;
        }
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
      // Filter out null values to prevent null entries in the JSON array
      return `json_agg(${fieldReference}) FILTER (WHERE ${fieldReference} IS NOT NULL)`;
    } else if (driver === DriverClient.Sqlite) {
      // For SQLite, we need to handle null filtering differently
      return `json_group_array(${fieldReference}) WHERE ${fieldReference} IS NOT NULL`;
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  /**
   * Generate rollup aggregation expression based on rollup function
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private generateRollupAggregation(
    expression: string,
    fieldExpression: string,
    targetField?: IFieldInstance,
    junctionAlias?: string
  ): string {
    // Parse the rollup function from expression like 'sum({values})'
    const functionMatch = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!functionMatch) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }

    const functionName = functionMatch[1].toLowerCase();
    const castIfPg = (sql: string) =>
      this.dbProvider.driver === DriverClient.Pg ? `CAST(${sql} AS DOUBLE PRECISION)` : sql;

    switch (functionName) {
      case 'sum':
        return castIfPg(`COALESCE(SUM(${fieldExpression}), 0)`);
      case 'count':
        return castIfPg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'countall':
        // For multiple select fields, count individual elements in JSON arrays
        if (targetField?.type === FieldType.MultipleSelect) {
          if (this.dbProvider.driver === DriverClient.Pg) {
            // PostgreSQL: Sum the length of each JSON array, ensure 0 when no records
            return castIfPg(
              `COALESCE(SUM(CASE WHEN ${fieldExpression} IS NOT NULL THEN jsonb_array_length(${fieldExpression}::jsonb) ELSE 0 END), 0)`
            );
          } else {
            // SQLite: Sum the length of each JSON array, ensure 0 when no records
            return castIfPg(
              `COALESCE(SUM(CASE WHEN ${fieldExpression} IS NOT NULL THEN json_array_length(${fieldExpression}) ELSE 0 END), 0)`
            );
          }
        }
        // For other field types, count non-null values, ensure 0 when no records
        return castIfPg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'counta':
        return castIfPg(`COALESCE(COUNT(${fieldExpression}), 0)`);
      case 'max':
        return castIfPg(`MAX(${fieldExpression})`);
      case 'min':
        return castIfPg(`MIN(${fieldExpression})`);
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
        // Join all values into a single string with deterministic ordering
        if (junctionAlias) {
          // Use junction table ID for ordering to maintain insertion order
          return this.dbProvider.driver === DriverClient.Pg
            ? `STRING_AGG(${fieldExpression}::text, ', ' ORDER BY ${junctionAlias}.__id)`
            : `GROUP_CONCAT(${fieldExpression}, ', ')`;
        } else {
          // Fallback to value-based ordering for consistency
          return this.dbProvider.driver === DriverClient.Pg
            ? `STRING_AGG(${fieldExpression}::text, ', ' ORDER BY ${fieldExpression}::text)`
            : `GROUP_CONCAT(${fieldExpression}, ', ')`;
        }
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

  /**
   * Generate rollup expression for single-value relationships (ManyOne/OneOne)
   * Avoids using aggregate functions so GROUP BY is not required.
   */
  private generateSingleValueRollupAggregation(
    expression: string,
    fieldExpression: string
  ): string {
    const functionMatch = expression.match(/^(\w+)\(\{values\}\)$/);
    if (!functionMatch) {
      throw new Error(`Invalid rollup expression: ${expression}`);
    }

    const functionName = functionMatch[1].toLowerCase();

    switch (functionName) {
      case 'sum':
        // For single-value relationship, sum reduces to the value itself, but should be 0 when null
        return `COALESCE(${fieldExpression}, 0)`;
      case 'max':
      case 'min':
      case 'array_join':
      case 'concatenate':
        // For single-value relationship, these reduce to the value itself
        return `${fieldExpression}`;
      case 'count':
      case 'countall':
      case 'counta':
        // Presence check: 1 if not null, else 0
        return `CASE WHEN ${fieldExpression} IS NULL THEN 0 ELSE 1 END`;
      case 'and':
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COALESCE((${fieldExpression})::boolean, false))`
          : `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'or':
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COALESCE((${fieldExpression})::boolean, false))`
          : `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'xor':
        // With a single value, XOR is equivalent to the value itself
        return this.dbProvider.driver === DriverClient.Pg
          ? `(COALESCE((${fieldExpression})::boolean, false))`
          : `(CASE WHEN ${fieldExpression} THEN 1 ELSE 0 END)`;
      case 'array_unique':
      case 'array_compact':
        // Wrap single value into JSON array if present else empty array
        return this.dbProvider.driver === DriverClient.Pg
          ? `(CASE WHEN ${fieldExpression} IS NULL THEN '[]'::json ELSE json_build_array(${fieldExpression}) END)`
          : `(CASE WHEN ${fieldExpression} IS NULL THEN json('[]') ELSE json_array(${fieldExpression}) END)`;
      default:
        // Fallback to the value to keep behavior sensible
        return `${fieldExpression}`;
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

  visitButtonField(field: ButtonFieldCore): ICteResult {
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
