import { Injectable } from '@nestjs/common';
import { type IFormulaConversionContext, FieldType, type ILinkFieldOptions } from '@teable/core';
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
} from './record-query-builder.interface';

/**
 * Service for building table record queries
 * This service encapsulates the logic for creating Knex query builders
 * with proper field selection using the visitor pattern
 */
@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  /**
   * Build a query builder with select fields for the given table and fields
   */
  buildQuery(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    viewId: string | undefined,
    fields: IFieldInstance[],
    linkFieldCteContext: ILinkFieldCteContext
  ): Knex.QueryBuilder {
    const params: IRecordQueryParams = {
      tableId,
      viewId,
      fields,
      queryBuilder,
      linkFieldContexts: linkFieldCteContext.linkFieldContexts,
    };

    return this.buildQueryWithParams(params, linkFieldCteContext);
  }

  /**
   * Build query with Link field contexts (async version for external use)
   */
  async buildQueryWithLinkContexts(
    queryBuilder: Knex.QueryBuilder,
    tableId: string,
    viewId: string | undefined,
    fields: IFieldInstance[]
  ): Promise<{ qb: Knex.QueryBuilder }> {
    const mainTableName = await this.getDbTableName(tableId);
    const linkFieldCteContext = await this.createLinkFieldContexts(fields, tableId, mainTableName);

    const qb = this.buildQuery(queryBuilder, tableId, viewId, fields, linkFieldCteContext);
    return { qb };
  }

  /**
   * Build query with detailed parameters
   */
  private buildQueryWithParams(
    params: IRecordQueryParams,
    linkFieldCteContext: ILinkFieldCteContext
  ): Knex.QueryBuilder {
    const { fields, queryBuilder, linkFieldContexts } = params;
    const { mainTableName } = linkFieldCteContext;

    // Build formula conversion context
    const context = this.buildFormulaContext(fields);

    // Add field CTEs and their JOINs if Link field contexts are provided
    const fieldCteMap = this.addFieldCtesSync(
      queryBuilder,
      fields,
      mainTableName,
      linkFieldContexts,
      linkFieldCteContext.tableNameMap
    );

    // Build select fields
    return this.buildSelect(queryBuilder, fields, context, fieldCteMap);
  }

  /**
   * Build select fields using visitor pattern
   */
  private buildSelect(
    qb: Knex.QueryBuilder,
    fields: IFieldInstance[],
    context: IFormulaConversionContext,
    fieldCteMap?: Map<string, string>
  ): Knex.QueryBuilder {
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

    return qb;
  }

  /**
   * Get database table name for a given table ID
   */
  private async getDbTableName(tableId: string): Promise<string> {
    const table = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    return table.dbTableName;
  }

  /**
   * Add field CTEs and their JOINs to the query builder (synchronous version)
   */
  private addFieldCtesSync(
    queryBuilder: Knex.QueryBuilder,
    fields: IFieldInstance[],
    mainTableName: string,
    linkFieldContexts?: ILinkFieldContext[],
    contextTableNameMap?: Map<string, string>
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

    return fieldCteMap;
  }

  /**
   * Create Link field contexts for CTE generation
   */
  async createLinkFieldContexts(
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

    return {
      linkFieldContexts,
      mainTableName,
      tableNameMap,
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
