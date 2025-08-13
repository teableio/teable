import { Injectable, Logger } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { IFilter, IFormulaConversionContext, ILinkFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../../field/constant';
import { FieldCteVisitor, type IFieldCteContext } from '../../field/field-cte-visitor';
import { FieldSelectVisitor } from '../../field/field-select-visitor';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import type {
  IRecordQueryBuilder,
  IRecordQueryParams,
  ILinkFieldContext,
  ILinkFieldCteContext,
  IRecordSelectionMap,
} from './record-query-builder.interface';

/**
 * Service for building table record queries
 * This service encapsulates the logic for creating Knex query builders
 * with proper field selection using the visitor pattern
 */
@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  private readonly logger = new Logger(RecordQueryBuilderService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  /**
   * Create a record query builder with select fields for the given table
   */
  async createRecordQueryBuilder(
    queryBuilder: Knex.QueryBuilder,
    tableIdOrDbTableName: string,
    viewId: string | undefined,
    filter?: IFilter,
    currentUserId?: string
  ): Promise<{ qb: Knex.QueryBuilder }> {
    const { tableId, dbTableName } = await this.getTableInfo(tableIdOrDbTableName);
    const fields = await this.getAllFields(tableId);
    const linkFieldCteContext = await this.createLinkFieldContexts(fields, tableId, dbTableName);

    const params: IRecordQueryParams = {
      tableId,
      viewId,
      fields,
      queryBuilder,
      linkFieldContexts: linkFieldCteContext.linkFieldContexts,
      filter,
      currentUserId,
    };

    const qb = this.buildQueryWithParams(params, linkFieldCteContext);
    return { qb };
  }

  /**
   * Build query with detailed parameters
   */
  private buildQueryWithParams(
    params: IRecordQueryParams,
    linkFieldCteContext: ILinkFieldCteContext
  ): Knex.QueryBuilder {
    const { fields, queryBuilder, linkFieldContexts, filter, currentUserId } = params;
    const { mainTableName } = linkFieldCteContext;

    // Build formula conversion context
    const context = this.buildFormulaContext(fields);

    // Add field CTEs and their JOINs if Link field contexts are provided
    const fieldCteMap = this.addFieldCtesSync(
      queryBuilder,
      fields,
      mainTableName,
      linkFieldContexts,
      linkFieldCteContext.tableNameMap,
      linkFieldCteContext.additionalFields
    );

    // Build select fields
    const selectionMap = this.buildSelect(queryBuilder, fields, context, fieldCteMap);

    if (filter) {
      this.buildFilter(queryBuilder, fields, filter, selectionMap, currentUserId);
    }

    return queryBuilder;
  }

  /**
   * Build select fields using visitor pattern
   */
  private buildSelect(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    context: IFormulaConversionContext,
    fieldCteMap?: Map<string, string>
  ): IRecordSelectionMap {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, context, fieldCteMap);

    // Add default system fields
    qb.select(Array.from(preservedDbFieldNames));

    // Add field-specific selections using visitor pattern
    for (const field of fields) {
      const result = field.accept(visitor);
      if (result) {
        qb.select(result);
      }
    }

    return visitor.getSelectionMap();
  }

  private buildFilter(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    filter: IFilter,
    selectionMap: IRecordSelectionMap,
    currentUserId?: string
  ): this {
    const map = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldInstance>
    );
    this.dbProvider
      .filterQuery(qb, map, filter, { withUserId: currentUserId }, { selectionMap })
      .appendQueryBuilder();
    return this;
  }

  /**
   * Get table information for a given table ID or database table name
   */
  private async getTableInfo(
    tableIdOrDbTableName: string
  ): Promise<{ tableId: string; dbTableName: string }> {
    const table = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { OR: [{ id: tableIdOrDbTableName }, { dbTableName: tableIdOrDbTableName }] },
      select: { id: true, dbTableName: true },
    });

    return { tableId: table.id, dbTableName: table.dbTableName };
  }

  /**
   * Get all fields for a given table ID
   */
  private async getAllFields(tableId: string): Promise<IFieldInstance[]> {
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
    });

    return fields.map((field) => createFieldInstanceByRaw(field));
  }

  /**
   * Get database table name for a given table ID
   */
  private async getDbTableName(tableId: string): Promise<string> {
    const table = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { OR: [{ id: tableId }, { dbTableName: tableId }] },
      select: { dbTableName: true },
    });

    return table.dbTableName;
  }

  /**
   * Add field CTEs and their JOINs to the query builder (synchronous version)
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private addFieldCtesSync(
    queryBuilder: Knex.QueryBuilder,
    fields: IFieldInstance[],
    mainTableName: string,
    linkFieldContexts?: ILinkFieldContext[],
    contextTableNameMap?: Map<string, string>,
    additionalFields?: Map<string, IFieldInstance>
  ): Map<string, string> {
    const fieldCteMap = new Map<string, string>();

    if (!linkFieldContexts?.length) return fieldCteMap;

    const fieldMap = new Map<string, IFieldInstance>();
    const tableNameMap = new Map<string, string>();

    fields.forEach((field) => fieldMap.set(field.id, field));

    for (const linkContext of linkFieldContexts) {
      fieldMap.set(linkContext.lookupField.id, linkContext.lookupField);
      // Also add the link field to the field map for nested lookup support
      fieldMap.set(linkContext.linkField.id, linkContext.linkField);
      const options = linkContext.linkField.options as ILinkFieldOptions;
      tableNameMap.set(options.foreignTableId, linkContext.foreignTableName);
    }

    // Add additional fields (e.g., rollup target fields) to the field map
    if (additionalFields) {
      for (const [fieldId, field] of additionalFields) {
        fieldMap.set(fieldId, field);
      }
    }

    // Merge with context table name map for nested lookup support
    if (contextTableNameMap) {
      for (const [tableId, tableName] of contextTableNameMap) {
        tableNameMap.set(tableId, tableName);
      }
    }

    const context: IFieldCteContext = { mainTableName, fieldMap, tableNameMap };
    const cteVisitor = new FieldCteVisitor(this.dbProvider, context);

    for (const field of fields) {
      // Process Link fields (non-Lookup) and Lookup fields
      if ((field.type === FieldType.Link && !field.isLookup) || field.isLookup) {
        const result = field.accept(cteVisitor);
        if (result.hasChanges && result.cteName && result.cteCallback) {
          queryBuilder.with(result.cteName, result.cteCallback);
          // Add LEFT JOIN for the CTE
          queryBuilder.leftJoin(
            result.cteName,
            `${mainTableName}.__id`,
            `${result.cteName}.main_record_id`
          );
          fieldCteMap.set(field.id, result.cteName);
        }
      }
    }

    // Add CTE mappings for lookup and rollup fields that depend on link field CTEs
    // This ensures that lookup and rollup fields can be properly referenced in formulas
    for (const field of fields) {
      if (field.isLookup && field.lookupOptions) {
        const { linkFieldId } = field.lookupOptions;
        // If the link field has a CTE but the lookup field doesn't, map the lookup field to the link field's CTE
        if (linkFieldId && fieldCteMap.has(linkFieldId) && !fieldCteMap.has(field.id)) {
          fieldCteMap.set(field.id, fieldCteMap.get(linkFieldId)!);
        }
        // eslint-disable-next-line sonarjs/no-duplicated-branches
      } else if (field.type === FieldType.Rollup && field.lookupOptions) {
        const { linkFieldId } = field.lookupOptions;
        // If the link field has a CTE but the rollup field doesn't, map the rollup field to the link field's CTE
        if (linkFieldId && fieldCteMap.has(linkFieldId) && !fieldCteMap.has(field.id)) {
          fieldCteMap.set(field.id, fieldCteMap.get(linkFieldId)!);
        }
      }
    }

    return fieldCteMap;
  }

  /**
   * Create Link field contexts for CTE generation
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async createLinkFieldContexts(
    fields: IFieldInstance[],
    tableId: string,
    mainTableName: string
  ): Promise<ILinkFieldCteContext> {
    const linkFieldContexts: ILinkFieldContext[] = [];
    const tableNameMap = new Map<string, string>();

    for (const field of fields) {
      // Handle Link fields (non-Lookup)
      if (field.type === FieldType.Link && !field.isLookup) {
        const options = field.options as ILinkFieldOptions;
        const [lookupField, foreignTableName] = await Promise.all([
          this.getLookupField(options.lookupFieldId),
          this.getDbTableName(options.foreignTableId),
        ]);

        linkFieldContexts.push({
          linkField: field,
          lookupField,
          foreignTableName,
        });

        // Store table name mapping for nested lookup processing
        tableNameMap.set(options.foreignTableId, foreignTableName);
      }
      // Handle Lookup fields (any field type with isLookup: true)
      else if (field.isLookup && field.lookupOptions) {
        const { lookupOptions } = field;

        // For nested lookup fields, we need to collect all tables in the chain
        await this.collectNestedLookupTables(field, tableNameMap, linkFieldContexts);

        // For lookup -> link fields, we need to collect the target link field's context
        await this.collectLookupToLinkTables(field, tableNameMap, linkFieldContexts);

        // For lookup fields, we need to get both the link field and the lookup target field
        const [linkField, lookupField, foreignTableName] = await Promise.all([
          this.getLookupField(lookupOptions.linkFieldId), // Get the link field
          this.getLookupField(lookupOptions.lookupFieldId), // Get the target field
          this.getDbTableName(lookupOptions.foreignTableId),
        ]);

        // Create a Link field context for Lookup fields
        linkFieldContexts.push({
          linkField, // Use the actual link field, not the lookup field itself
          lookupField,
          foreignTableName,
        });

        // Store table name mapping
        tableNameMap.set(lookupOptions.foreignTableId, foreignTableName);
      }
    }

    // Collect additional fields needed for rollup fields
    const additionalFields = new Map<string, IFieldInstance>();
    for (const field of fields) {
      if (field.type === FieldType.Rollup && field.lookupOptions) {
        const { lookupFieldId } = field.lookupOptions;
        // Check if this target field is not already in linkFieldContexts
        const isAlreadyIncluded = linkFieldContexts.some(
          (ctx) => ctx.lookupField.id === lookupFieldId
        );
        if (!isAlreadyIncluded && !additionalFields.has(lookupFieldId)) {
          try {
            const rollupTargetField = await this.getLookupField(lookupFieldId);
            additionalFields.set(lookupFieldId, rollupTargetField);
          } catch (error) {
            this.logger.warn(`Failed to get rollup target field ${lookupFieldId}:`, error);
          }
        }
      }
    }

    return {
      linkFieldContexts,
      mainTableName,
      tableNameMap,
      additionalFields: additionalFields.size > 0 ? additionalFields : undefined,
    };
  }

  /**
   * Collect all table names and link fields in a nested lookup chain
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async collectNestedLookupTables(
    field: IFieldInstance,
    tableNameMap: Map<string, string>,
    linkFieldContexts: ILinkFieldContext[]
  ): Promise<void> {
    if (!field.isLookup || !field.lookupOptions) {
      return;
    }

    const visitedFields = new Set<string>();
    let currentField = field;

    while (currentField.isLookup && currentField.lookupOptions) {
      // Prevent circular references
      if (visitedFields.has(currentField.id)) {
        break;
      }
      visitedFields.add(currentField.id);

      const { lookupOptions } = currentField;
      const { lookupFieldId, linkFieldId, foreignTableId } = lookupOptions;

      // Store the foreign table name
      if (!tableNameMap.has(foreignTableId)) {
        try {
          const foreignTableName = await this.getDbTableName(foreignTableId);
          tableNameMap.set(foreignTableId, foreignTableName);
        } catch (error) {
          // If we can't get the table name, skip this table
          break;
        }
      }

      // Get the link field for this lookup and add it to contexts
      try {
        const [linkField, lookupField, foreignTableName] = await Promise.all([
          this.getLookupField(linkFieldId),
          this.getLookupField(lookupFieldId),
          this.getDbTableName(foreignTableId),
        ]);

        // Add link field context if not already present
        const existingContext = linkFieldContexts.find((ctx) => ctx.linkField.id === linkField.id);
        if (!existingContext) {
          linkFieldContexts.push({
            linkField,
            lookupField,
            foreignTableName,
          });
        }
      } catch (error) {
        // If we can't get the fields, continue to next
      }

      // Move to the next field in the chain
      try {
        const nextField = await this.getLookupField(lookupFieldId);
        if (!nextField.isLookup) {
          // We've reached the end of the chain
          break;
        }
        currentField = nextField;
      } catch (error) {
        // If we can't get the next field, stop the chain
        break;
      }
    }
  }

  /**
   * Collect table names and link fields for lookup -> link fields
   */
  private async collectLookupToLinkTables(
    field: IFieldInstance,
    tableNameMap: Map<string, string>,
    linkFieldContexts: ILinkFieldContext[]
  ): Promise<void> {
    if (!field.isLookup || !field.lookupOptions) {
      return;
    }

    const { lookupOptions } = field;
    const { lookupFieldId, foreignTableId } = lookupOptions;

    try {
      // Get the target field that the lookup is looking up
      const targetField = await this.getLookupField(lookupFieldId);

      // Check if the target field is a link field
      if (targetField.type === FieldType.Link && !targetField.isLookup) {
        console.log(
          `[DEBUG] Found lookup -> link field ${field.id} targeting link field ${targetField.id}`
        );

        // Get the target link field's options
        const targetLinkOptions = targetField.options as ILinkFieldOptions;

        // Store the foreign table name for the lookup field
        if (!tableNameMap.has(foreignTableId)) {
          const foreignTableName = await this.getDbTableName(foreignTableId);
          tableNameMap.set(foreignTableId, foreignTableName);
        }

        // Store the target link field's foreign table name
        if (!tableNameMap.has(targetLinkOptions.foreignTableId)) {
          const targetForeignTableName = await this.getDbTableName(
            targetLinkOptions.foreignTableId
          );
          tableNameMap.set(targetLinkOptions.foreignTableId, targetForeignTableName);
        }

        // Get the target link field's lookup field
        const targetLookupField = await this.getLookupField(targetLinkOptions.lookupFieldId);
        const targetForeignTableName = await this.getDbTableName(targetLinkOptions.foreignTableId);

        // Add the target link field context if not already present
        const existingContext = linkFieldContexts.find(
          (ctx) => ctx.linkField.id === targetField.id
        );
        if (!existingContext) {
          linkFieldContexts.push({
            linkField: targetField,
            lookupField: targetLookupField,
            foreignTableName: targetForeignTableName,
          });
          console.log(`[DEBUG] Added target link field context for ${targetField.id}`);
        }
      }
    } catch (error) {
      console.log(`[DEBUG] Failed to collect lookup -> link tables for ${field.id}:`, error);
    }
  }

  /**
   * Get lookup field instance by ID
   */
  private async getLookupField(lookupFieldId: string): Promise<IFieldInstance> {
    const fieldRaw = await this.prismaService.txClient().field.findUniqueOrThrow({
      where: { id: lookupFieldId },
    });

    return createFieldInstanceByRaw(fieldRaw);
  }

  /**
   * Build formula conversion context from fields
   */
  private buildFormulaContext(fields: IFieldInstance[]): IFormulaConversionContext {
    const fieldMap = new Map();
    fields.forEach((field) => {
      fieldMap.set(field.id, field);
    });
    return {
      fieldMap,
    };
  }
}
