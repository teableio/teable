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
  finalField: IFieldInstance; // 最终的非 lookup 字段
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
  private readonly processedForeignTables = new Set<string>();

  constructor(
    private readonly dbProvider: IDbProvider,
    private readonly context: IFieldCteContext
  ) {}

  /**
   * Generate JSON aggregation function for Link fields (creates objects with id and title)
   */
  private getLinkJsonAggregationFunction(
    tableAlias: string,
    fieldExpression: string,
    relationship: Relationship
  ): string {
    const driver = this.dbProvider.driver;

    // Use table alias for cleaner SQL
    const recordIdRef = `${tableAlias}."__id"`;
    const titleRef = fieldExpression;

    // Determine if this relationship should return multiple values (array) or single value (object)
    const isMultiValue =
      relationship === Relationship.ManyMany || relationship === Relationship.OneMany;

    if (driver === DriverClient.Pg) {
      if (isMultiValue) {
        // Filter out null records and return empty array if no valid records exist
        return `COALESCE(json_agg(json_build_object('id', ${recordIdRef}, 'title', ${titleRef})) FILTER (WHERE ${recordIdRef} IS NOT NULL), '[]'::json)`;
      } else {
        // For single value relationships (ManyOne, OneOne), return single object or null
        return `CASE WHEN ${recordIdRef} IS NOT NULL THEN json_build_object('id', ${recordIdRef}, 'title', ${titleRef}) ELSE NULL END`;
      }
    } else if (driver === DriverClient.Sqlite) {
      if (isMultiValue) {
        // For SQLite, we need to handle null filtering differently
        return `CASE WHEN COUNT(${recordIdRef}) > 0 THEN json_group_array(json_object('id', ${recordIdRef}, 'title', ${titleRef})) ELSE '[]' END`;
      } else {
        // For single value relationships, return single object or null
        return `CASE WHEN ${recordIdRef} IS NOT NULL THEN json_object('id', ${recordIdRef}, 'title', ${titleRef}) ELSE NULL END`;
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
    id: string;
  }): ICteResult {
    if (field.isLookup && field.lookupOptions) {
      // Check if this is a nested lookup field (lookup -> lookup)
      if (this.isNestedLookup(field)) {
        return this.generateNestedLookupCte(field);
      }

      // Check if this is a lookup to link field (lookup -> link)
      const targetField = this.context.fieldMap.get(field.lookupOptions.lookupFieldId);
      if (targetField?.type === FieldType.Link && !targetField.isLookup) {
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

    // If the target field is also a lookup field, then this is a nested lookup
    return targetField?.isLookup === true;
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

    // If the target field is a link field (and not a lookup field), then this is a lookup to link
    const isLookupToLink = targetField?.type === FieldType.Link && !targetField.isLookup;

    this.logger.warn(
      `[DEBUG] Checking lookup to link for field ${field.id}: target field ${field.lookupOptions.lookupFieldId} type=${targetField?.type}, isLookup=${targetField?.isLookup}, result=${isLookupToLink}`
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
    const cteCallback = (qb: Knex.QueryBuilder) => {
      const mainAlias = 'm';
      const junctionAlias = 'j';
      const foreignAlias = 'f';
      const linkTargetAlias = 'lt'; // alias for the table that link field points to

      // Build select columns
      const selectColumns = [`${mainAlias}.__id as main_record_id`];

      // Create FieldSelectVisitor to get the correct field expression for the target field
      const tempQb = qb.client.queryBuilder();
      const fieldSelectVisitor = new FieldSelectVisitor(
        tempQb,
        this.dbProvider,
        { fieldMap: this.context.fieldMap },
        undefined, // No fieldCteMap to prevent recursive processing
        linkTargetAlias
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
          targetLinkRelationship
        );
        jsonExpression = jsonAggFunction;
      } else {
        // For single-value relationships, use direct CASE WHEN
        jsonExpression = `CASE WHEN ${linkTargetAlias}.__id IS NOT NULL THEN json_build_object('id', ${linkTargetAlias}.__id, 'title', ${fieldExpression}) ELSE NULL END`;
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
        query = query.groupBy(`${mainAlias}.__id`);
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
        fieldExpression,
        options.relationship
      );
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
          const isSingleValueRelationship =
            options.relationship === Relationship.ManyOne ||
            options.relationship === Relationship.OneOne;
          const rollupAggregation = isSingleValueRelationship
            ? this.generateSingleValueRollupAggregation(rollupOptions.expression, fieldExpression3)
            : this.generateRollupAggregation(rollupOptions.expression, fieldExpression3);
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
      let needsGroupBy = false;

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

          // Determine if this relationship needs aggregation
          const isMultiValue =
            linkOptions.relationship === Relationship.ManyMany ||
            linkOptions.relationship === Relationship.OneMany;
          needsGroupBy ||= isMultiValue;

          const jsonAggFunction = this.getLinkJsonAggregationFunction(
            foreignAlias,
            fieldExpression,
            linkOptions.relationship
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
            needsGroupBy ||= true; // Multi-value lookup fields also need GROUP BY
          } else {
            selectColumns.push(qb.client.raw(`${fieldExpression} as "lookup_${lookupField.id}"`));
          }
        }
      }

      // Get JOIN information from the first Lookup field (they should all have the same JOIN logic for the same foreign table)
      const firstLookup = lookupFields[0];
      const { fkHostTableName, selfKeyName, foreignKeyName } = firstLookup.lookupOptions!;

      const query = qb
        .select(selectColumns)
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
        );

      // Only add GROUP BY if we need aggregation (for multi-value relationships)
      if (needsGroupBy) {
        query.groupBy(`${mainAlias}.__id`);
      }
    };

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
  private generateRollupAggregation(expression: string, fieldExpression: string): string {
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
        return castIfPg(`SUM(${fieldExpression})`);
      case 'count':
        return castIfPg(`COUNT(${fieldExpression})`);
      case 'countall':
        return castIfPg(`COUNT(*)`);
      case 'counta':
        return castIfPg(`COUNT(${fieldExpression})`);
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
