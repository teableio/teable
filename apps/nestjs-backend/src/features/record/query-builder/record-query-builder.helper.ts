/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, Logger } from '@nestjs/common';
import type { IFormulaConversionContext, ILinkFieldOptions } from '@teable/core';
import { FieldType, FieldReferenceVisitor, FormulaFieldCore } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { FieldCteVisitor, type IFieldCteContext } from '../../field/field-cte-visitor';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import type { ILinkFieldContext, ILinkFieldCteContext } from './record-query-builder.interface';

/**
 * Interface for CTE generation planning
 */
interface ICTEGenerationPlan {
  dependencies: Map<string, Set<string>>;
  generationOrder: string[];
  crossTableDependencies: Map<string, string[]>;
}

/**
 * Helper class for record query builder operations
 * Contains utility methods for data retrieval and structure building
 * This class is internal to the query builder module and not exported
 * @private This class is not part of the public API and is not exported
 */
@Injectable()
export class RecordQueryBuilderHelper {
  private readonly logger = new Logger(RecordQueryBuilderHelper.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  /**
   * Get table information for a given table ID or database table name
   */
  async getTableInfo(
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
  async getAllFields(tableId: string): Promise<IFieldInstance[]> {
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
    });

    return fields.map((field) => createFieldInstanceByRaw(field));
  }

  /**
   * Get database table name for a given table ID
   */
  async getDbTableName(tableId: string): Promise<string> {
    const table = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { OR: [{ id: tableId }, { dbTableName: tableId }] },
      select: { dbTableName: true },
    });

    return table.dbTableName;
  }

  /**
   * Get table ID for a given field ID
   */
  private async getTableIdByFieldId(fieldId: string): Promise<string | null> {
    try {
      const field = await this.prismaService.txClient().field.findFirst({
        where: { id: fieldId, deletedTime: null },
        select: { tableId: true },
      });
      return field?.tableId || null;
    } catch (error) {
      this.logger.warn(
        `Could not find table ID for field ${fieldId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Get lookup field instance by ID
   */
  async getLookupField(lookupFieldId: string): Promise<IFieldInstance> {
    const fieldRaw = await this.prismaService.txClient().field.findUniqueOrThrow({
      where: { id: lookupFieldId },
    });

    return createFieldInstanceByRaw(fieldRaw);
  }

  /**
   * Build formula conversion context from fields for formula field processing
   *
   * This method creates a context object that contains field mappings needed for
   * formula field evaluation and conversion. The context is used by formula processors
   * to resolve field references and perform calculations.
   *
   * @param fields - Array of all field instances from the table
   * @returns IFormulaConversionContext containing field mappings
   *
   * @example
   * Input fields:
   * [
   *   TextField{id: 'fld1', name: 'Name'},
   *   NumberField{id: 'fld2', name: 'Price'},
   *   FormulaField{id: 'fld3', name: 'Total', formula: '{fld2} * 1.2'}
   * ]
   *
   * Output:
   * {
   *   fieldMap: Map {
   *     'fld1' => TextField{id: 'fld1', name: 'Name'},
   *     'fld2' => NumberField{id: 'fld2', name: 'Price'},
   *     'fld3' => FormulaField{id: 'fld3', name: 'Total'}
   *   }
   * }
   *
   * Usage in formula processing:
   * - Formula parser uses fieldMap to resolve field references like {fld2}
   * - Type checking ensures formula operations are valid for field types
   * - SQL generation converts field references to appropriate column expressions
   *
   * Future enhancements:
   * - Add field type validation for formula compatibility
   * - Include field metadata for better error messages
   * - Support for custom function definitions
   */
  buildFormulaContext(fields: IFieldInstance[]): IFormulaConversionContext {
    const fieldMap = new Map();
    fields.forEach((field) => {
      fieldMap.set(field.id, field);
    });
    return {
      fieldMap,
    };
  }

  /**
   * Analyze all fields to identify cross-table dependencies that require additional link contexts
   * This is crucial for handling cases where formula fields reference fields from other tables
   */
  async analyzeFormulaFieldDependencies(
    fields: IFieldInstance[],
    tableId: string
  ): Promise<IFieldInstance[]> {
    const additionalLinkFields: IFieldInstance[] = [];

    for (const field of fields) {
      if (field.type === FieldType.Formula) {
        this.logger.debug(`Analyzing formula field: ${field.name} (${field.id})`);

        try {
          const tree = FormulaFieldCore.parse(field.options.expression);
          const visitor = new FieldReferenceVisitor();
          const referencedFieldIds = visitor.visit(tree);

          // Check if any referenced fields are from other tables (link fields)
          for (const refFieldId of referencedFieldIds) {
            // Try to find this field in current table first
            const localField = fields.find((f) => f.id === refFieldId);
            if (!localField) {
              // This field is not in the current table, we need to fetch it
              try {
                const foreignField = await this.getFieldById(refFieldId);
                if (foreignField && foreignField.type === FieldType.Link) {
                  this.logger.debug(
                    `Found cross-table link field: ${foreignField.name} (${foreignField.id})`
                  );
                  additionalLinkFields.push(foreignField);
                }
              } catch (error) {
                this.logger.warn(
                  `Could not fetch field ${refFieldId}: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            } else if (localField.type === FieldType.Link) {
              // This is a link field in the current table, make sure it's included
              if (!additionalLinkFields.some((f) => f.id === localField.id)) {
                additionalLinkFields.push(localField);
              }
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to parse formula: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    // Second, check if any link fields in the current table point to tables with formula fields
    // This is crucial for bidirectional relationships where the foreign table has formula fields
    for (const field of fields) {
      if (field.type === FieldType.Link && !field.isLookup) {
        this.logger.debug(
          `Checking link field for foreign formula dependencies: ${field.name} (${field.id})`
        );

        try {
          const linkOptions = field.options as ILinkFieldOptions;
          const foreignTableId = linkOptions.foreignTableId;

          // Get all fields from the foreign table
          const foreignFields = await this.getAllFields(foreignTableId);

          // Check if any foreign fields are formula fields that reference link fields
          for (const foreignField of foreignFields) {
            if (foreignField.type === FieldType.Formula) {
              try {
                const tree = FormulaFieldCore.parse(foreignField.options.expression);
                const visitor = new FieldReferenceVisitor();
                const referencedFieldIds = visitor.visit(tree);

                // Check if this formula references any link fields
                for (const refFieldId of referencedFieldIds) {
                  const refField = foreignFields.find((f) => f.id === refFieldId);
                  if (refField && refField.type === FieldType.Link) {
                    this.logger.debug(
                      `Foreign formula field references link field: ${refField.name} (${refField.id})`
                    );
                    // This foreign table has a formula field that references a link field
                    // We need to ensure the link field is included for CTE generation
                    if (!additionalLinkFields.some((f) => f.id === refField.id)) {
                      additionalLinkFields.push(refField);
                    }
                  }
                }
              } catch (error) {
                this.logger.warn(
                  `Failed to parse foreign formula: ${error instanceof Error ? error.message : String(error)}`
                );
              }
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to analyze foreign table: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    return additionalLinkFields;
  }

  /**
   * Get field by ID from any table
   */
  private async getFieldById(fieldId: string): Promise<IFieldInstance | null> {
    try {
      const fieldRaw = await this.prismaService.txClient().field.findUnique({
        where: { id: fieldId, deletedTime: null },
      });

      if (!fieldRaw) {
        return null;
      }

      return createFieldInstanceByRaw(fieldRaw);
    } catch (error) {
      return null;
    }
  }

  /**
   * Enhance fieldMap with additional fields for Formula fields in foreign tables
   * This method now handles complex dependencies including bidirectional links with formula fields
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async enhanceFieldMapForFormulaFields(
    fieldMap: Map<string, IFieldInstance>,
    tableNameMap: Map<string, string>
  ): Promise<void> {
    const processedTables = new Set<string>();
    const tablesToProcess = new Set<string>();

    // First pass: collect all tables that need to be processed
    for (const field of fieldMap.values()) {
      if (field.type === FieldType.Link && !field.isLookup) {
        const linkOptions = field.options as ILinkFieldOptions;
        tablesToProcess.add(linkOptions.foreignTableId);
      }
    }

    // Process each table and check for formula field dependencies
    for (const tableId of tablesToProcess) {
      if (processedTables.has(tableId)) {
        continue;
      }

      try {
        // Fetch all fields from the foreign table
        const foreignTableFields = await this.prismaService.txClient().field.findMany({
          where: { tableId, deletedTime: null },
        });

        // Add all foreign table fields to fieldMap
        const newFields: IFieldInstance[] = [];
        for (const rawField of foreignTableFields) {
          const fieldInstance = createFieldInstanceByRaw(rawField);
          if (!fieldMap.has(fieldInstance.id)) {
            fieldMap.set(fieldInstance.id, fieldInstance);
            newFields.push(fieldInstance);
          }
        }

        // Note: We don't need to recursively analyze formula dependencies here
        // as the main analyzeFormulaFieldDependencies method handles cross-table dependencies

        processedTables.add(tableId);
      } catch (error) {
        this.logger.warn(`Failed to fetch fields for table ${tableId}:`, error);
      }
    }
  }

  /**
   * Process an additional table that was discovered through formula field analysis
   */
  private async processAdditionalTable(
    tableId: string,
    fieldMap: Map<string, IFieldInstance>,
    tableNameMap: Map<string, string>,
    processedTables: Set<string>
  ): Promise<void> {
    try {
      // Fetch table name if not already in map
      if (!tableNameMap.has(tableId)) {
        const tableName = await this.getDbTableName(tableId);
        tableNameMap.set(tableId, tableName);
      }

      // Fetch all fields from this table
      const tableFields = await this.prismaService.txClient().field.findMany({
        where: { tableId, deletedTime: null },
      });

      // Add fields to fieldMap
      const newFields: IFieldInstance[] = [];
      for (const rawField of tableFields) {
        const fieldInstance = createFieldInstanceByRaw(rawField);
        if (!fieldMap.has(fieldInstance.id)) {
          fieldMap.set(fieldInstance.id, fieldInstance);
          newFields.push(fieldInstance);
        }
      }

      processedTables.add(tableId);

      // Recursively analyze new formula fields (with depth limit to prevent infinite recursion)
      // Note: We don't need to recursively analyze formula dependencies here
      // as the main analyzeFormulaFieldDependencies method handles cross-table dependencies
    } catch (error) {
      this.logger.warn(`Failed to process additional table ${tableId}:`, error);
    }
  }

  /**
   * Analyze CTE dependencies to determine the correct generation order
   * This handles complex cases like bidirectional links with formula fields
   */
  private async analyzeCTEDependencies(
    fields: IFieldInstance[],
    context: IFieldCteContext
  ): Promise<ICTEGenerationPlan> {
    const plan: ICTEGenerationPlan = {
      dependencies: new Map(),
      generationOrder: [],
      crossTableDependencies: new Map(),
    };

    // First pass: identify all fields that need CTEs
    const fieldsNeedingCTE = fields.filter(
      (field) => (field.type === FieldType.Link && !field.isLookup) || field.isLookup
    );

    // Also check for formula fields that reference link fields - they might need the link field's CTE
    const formulaFieldsReferencingLinks = new Set<string>();
    for (const field of fields) {
      if (field.type === FieldType.Formula) {
        try {
          const tree = FormulaFieldCore.parse(field.options.expression);
          const visitor = new FieldReferenceVisitor();
          const referencedFieldIds = visitor.visit(tree);

          // Check if any referenced fields are link fields that need CTEs
          for (const refFieldId of referencedFieldIds) {
            const refField = context.fieldMap.get(refFieldId);
            if (refField && refField.type === FieldType.Link && !refField.isLookup) {
              // This formula field references a link field, so the link field needs a CTE
              if (!fieldsNeedingCTE.some((f) => f.id === refFieldId)) {
                fieldsNeedingCTE.push(refField);
              }
              formulaFieldsReferencingLinks.add(field.id);
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to analyze formula field ${field.id}:`, error);
        }
      }
    }

    console.log(
      'Fields needing CTE:',
      fieldsNeedingCTE.map((f) => ({ id: f.id, type: f.type, name: f.name }))
    );
    console.log('Formula fields referencing links:', Array.from(formulaFieldsReferencingLinks));

    // Second pass: analyze dependencies for each field
    for (const field of fieldsNeedingCTE) {
      const dependencies = new Set<string>();

      if (field.type === FieldType.Link && !field.isLookup) {
        const linkOptions = field.options as ILinkFieldOptions;
        const lookupField = context.fieldMap.get(linkOptions.lookupFieldId);

        if (lookupField && lookupField.type === FieldType.Formula) {
          // This link field's lookup field is a formula - analyze its dependencies
          const formulaDeps = await this.analyzeFormulaDependencies(lookupField, context);
          for (const dep of formulaDeps) {
            dependencies.add(dep);
          }
        }
      }

      plan.dependencies.set(field.id, dependencies);
    }

    // Third pass: detect cross-table dependencies
    await this.detectCrossTableDependencies(fieldsNeedingCTE, context, plan);

    // Fourth pass: determine generation order using topological sort
    plan.generationOrder = this.topologicalSort(fieldsNeedingCTE, plan.dependencies);

    return plan;
  }

  /**
   * Analyze dependencies of a formula field
   */
  private async analyzeFormulaDependencies(
    formulaField: IFieldInstance,
    context: IFieldCteContext
  ): Promise<string[]> {
    if (formulaField.type !== FieldType.Formula) {
      return [];
    }

    try {
      const tree = FormulaFieldCore.parse(formulaField.options.expression);
      const visitor = new FieldReferenceVisitor();
      const referencedFieldIds = visitor.visit(tree);

      // Filter to only include link fields that need CTEs
      return referencedFieldIds.filter((fieldId) => {
        const field = context.fieldMap.get(fieldId);
        return field && field.type === FieldType.Link && !field.isLookup;
      });
    } catch (error) {
      this.logger.warn(`Failed to analyze formula dependencies for ${formulaField.id}:`, error);
      return [];
    }
  }

  /**
   * Detect cross-table dependencies that require additional CTEs
   */
  private async detectCrossTableDependencies(
    fields: IFieldInstance[],
    context: IFieldCteContext,
    plan: ICTEGenerationPlan
  ): Promise<void> {
    for (const field of fields) {
      if (field.type === FieldType.Link && !field.isLookup) {
        const linkOptions = field.options as ILinkFieldOptions;
        const lookupField = context.fieldMap.get(linkOptions.lookupFieldId);

        if (lookupField && lookupField.type === FieldType.Formula) {
          // Check if this formula references link fields from other tables
          try {
            const tree = FormulaFieldCore.parse(lookupField.options.expression);
            const visitor = new FieldReferenceVisitor();
            const referencedFieldIds = visitor.visit(tree);

            const crossTableDeps: string[] = [];
            for (const refFieldId of referencedFieldIds) {
              const refField = context.fieldMap.get(refFieldId);
              if (refField && refField.type === FieldType.Link && !refField.isLookup) {
                // This is a cross-table dependency
                crossTableDeps.push(refFieldId);
              }
            }

            if (crossTableDeps.length > 0) {
              plan.crossTableDependencies.set(field.id, crossTableDeps);
            }
          } catch (error) {
            this.logger.warn(`Failed to detect cross-table dependencies for ${field.id}:`, error);
          }
        }
      }
    }
  }

  /**
   * Perform topological sort to determine CTE generation order
   */
  private topologicalSort(
    fields: IFieldInstance[],
    dependencies: Map<string, Set<string>>
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (fieldId: string): void => {
      if (visited.has(fieldId)) {
        return;
      }
      if (visiting.has(fieldId)) {
        // Circular dependency detected - log warning and continue
        this.logger.warn(`Circular dependency detected involving field ${fieldId}`);
        return;
      }

      visiting.add(fieldId);
      const deps = dependencies.get(fieldId) || new Set();
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(fieldId);
      visited.add(fieldId);
      result.push(fieldId);
    };

    for (const field of fields) {
      visit(field.id);
    }

    return result;
  }

  /**
   * Generate CTEs in the correct dependency order
   */
  private async generateCTEsInOrder(
    queryBuilder: Knex.QueryBuilder,
    plan: ICTEGenerationPlan,
    context: IFieldCteContext,
    mainTableAlias: string,
    fieldCteMap: Map<string, string>
  ): Promise<void> {
    const cteVisitor = new FieldCteVisitor(this.dbProvider, context);
    const generatedCTEs = new Set<string>();

    // First, generate CTEs for cross-table dependencies
    for (const [, crossTableDeps] of plan.crossTableDependencies) {
      for (const depFieldId of crossTableDeps) {
        if (!generatedCTEs.has(depFieldId)) {
          await this.generateSingleCTE(
            queryBuilder,
            depFieldId,
            context,
            cteVisitor,
            mainTableAlias,
            fieldCteMap,
            generatedCTEs
          );
        }
      }
    }

    // Then generate CTEs in dependency order
    for (const fieldId of plan.generationOrder) {
      if (!generatedCTEs.has(fieldId)) {
        await this.generateSingleCTE(
          queryBuilder,
          fieldId,
          context,
          cteVisitor,
          mainTableAlias,
          fieldCteMap,
          generatedCTEs
        );
      }
    }
  }

  /**
   * Generate a single CTE for a field
   */
  private async generateSingleCTE(
    queryBuilder: Knex.QueryBuilder,
    fieldId: string,
    context: IFieldCteContext,
    _cteVisitor: FieldCteVisitor,
    mainTableAlias: string,
    fieldCteMap: Map<string, string>,
    generatedCTEs: Set<string>
  ): Promise<void> {
    const field = context.fieldMap.get(fieldId);
    if (!field) {
      return;
    }

    // Create a new visitor with updated fieldCteMap for each CTE generation
    const updatedContext = { ...context, fieldCteMap };
    const updatedVisitor = new FieldCteVisitor(this.dbProvider, updatedContext);

    const result = field.accept(updatedVisitor);
    if (result.hasChanges && result.cteName && result.cteCallback) {
      queryBuilder.with(result.cteName, result.cteCallback);
      // Add LEFT JOIN for the CTE
      queryBuilder.leftJoin(
        result.cteName,
        `${mainTableAlias}.__id`,
        `${result.cteName}.main_record_id`
      );
      fieldCteMap.set(field.id, result.cteName);
      generatedCTEs.add(fieldId);
    }
  }

  /**
   * Add field CTEs (Common Table Expressions) and their JOINs to the query builder
   *
   * This method processes Link and Lookup fields to create CTEs that aggregate related data.
   * It's essential for handling complex field relationships in the query.
   *
   * @param queryBuilder - The Knex query builder to modify
   * @param fields - Array of field instances from the main table
   * @param mainTableName - Database name of the main table (e.g., 'tbl_abc123')
   * @param linkFieldContexts - Contexts for Link fields containing foreign table info
   * @param contextTableNameMap - Map of table IDs to database table names for nested lookups
   * @param additionalFields - Extra fields needed for rollup calculations
   *
   * @returns Map of field IDs to their corresponding CTE names
   *
   * @example
   * Input:
   * - fields: [LinkField{id: 'fld1', type: 'Link'}, LookupField{id: 'fld2', type: 'SingleLineText', isLookup: true}]
   * - mainTableName: 'tbl_main123'
   * - linkFieldContexts: [{linkField: LinkField, lookupField: TextField, foreignTableName: 'tbl_foreign456'}]
   *
   * Output:
   * - fieldCteMap: Map{'fld1' => 'cte_link_fld1', 'fld2' => 'cte_link_fld1'}
   * - Query builder modified with:
   *   WITH cte_link_fld1 AS (SELECT main_record_id, aggregated_data FROM tbl_foreign456 ...)
   *   LEFT JOIN cte_link_fld1 ON tbl_main123.__id = cte_link_fld1.main_record_id
   *
   * Use cases:
   * - Link fields: Create CTEs to aggregate linked records
   * - Lookup fields: Map to their parent Link field's CTE for data access
   * - Rollup fields: Use CTEs for aggregation calculations
   * - Formula fields: Reference CTE data in formula expressions
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async addFieldCtesSync(
    queryBuilder: Knex.QueryBuilder,
    fields: IFieldInstance[],
    mainTableName: string,
    mainTableAlias: string,
    linkFieldContexts?: ILinkFieldContext[],
    contextTableNameMap?: Map<string, string>,
    additionalFields?: Map<string, IFieldInstance>
  ): Promise<{ fieldCteMap: Map<string, string>; enhancedContext: IFormulaConversionContext }> {
    this.logger.debug('addFieldCtesSync called for table: %s', mainTableName);

    // Debug link field contexts for formula lookup fields
    if (linkFieldContexts?.length) {
      linkFieldContexts.forEach((ctx) => {
        if (ctx.lookupField.type === 'formula') {
          this.logger.debug(
            `Formula lookup field detected: ${ctx.lookupField.name} (${ctx.lookupField.id})`
          );
          this.logger.debug(`Expression: ${ctx.lookupField.options?.expression}`);
        }
      });
    }

    const fieldCteMap = new Map<string, string>();

    if (!linkFieldContexts?.length) {
      return {
        fieldCteMap,
        enhancedContext: { fieldMap: new Map() },
      };
    }

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

    // Pre-fetch additional fields for Formula fields in foreign tables
    await this.enhanceFieldMapForFormulaFields(fieldMap, tableNameMap);

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

    // For each field, determine the correct main table based on the field's relationship
    // This is crucial for bidirectional link fields where different CTEs need different main tables
    const fieldTableMap = new Map<string, string>();
    for (const field of fields) {
      if (field.type === FieldType.Link && !field.isLookup) {
        // Get field table information for proper CTE generation

        // For bidirectional link fields, we need to determine which table this CTE should start from
        // The key insight is that each CTE should start from the table where the field is defined
        const fieldTableId = await this.getTableIdByFieldId(field.id);

        if (fieldTableId) {
          const fieldTableName = tableNameMap.get(fieldTableId);

          if (fieldTableName) {
            fieldTableMap.set(field.id, fieldTableName);
          }
        }
      }
    }

    const context: IFieldCteContext = { mainTableName, fieldMap, tableNameMap, fieldTableMap };

    // Analyze CTE dependencies and generate CTEs in the correct order
    const cteGenerationPlan = await this.analyzeCTEDependencies(fields, context);

    this.logger.debug('CTE Generation Plan:', {
      dependencies: Array.from(cteGenerationPlan.dependencies.entries()).map(([k, v]) => [
        k,
        Array.from(v),
      ]),
      generationOrder: cteGenerationPlan.generationOrder,
      crossTableDependencies: Array.from(cteGenerationPlan.crossTableDependencies.entries()),
    });

    // Generate CTEs according to the dependency plan
    await this.generateCTEsInOrder(
      queryBuilder,
      cteGenerationPlan,
      context,
      mainTableAlias,
      fieldCteMap
    );

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

    return {
      fieldCteMap,
      enhancedContext: { fieldMap },
    };
  }

  /**
   * Create Link field contexts for CTE generation and complex field relationship handling
   *
   * This method analyzes all fields in a table to identify Link and Lookup relationships,
   * then builds the necessary contexts for CTE generation. It handles complex scenarios
   * including nested lookups, lookup-to-link chains, and rollup field dependencies.
   *
   * @param fields - Array of all field instances from the table
   * @param _tableId - Table ID (currently unused but kept for future extensions)
   * @param mainTableName - Database name of the main table
   *
   * @returns Promise<ILinkFieldCteContext> containing:
   *   - linkFieldContexts: Array of contexts for each Link field relationship
   *   - mainTableName: Database name of the main table
   *   - tableNameMap: Map of table IDs to database table names
   *   - additionalFields: Extra fields needed for rollup calculations
   *
   * @example
   * Input fields:
   * - LinkField{id: 'fld1', type: 'Link', options: {foreignTableId: 'tbl2', lookupFieldId: 'fld_name'}}
   * - LookupField{id: 'fld2', type: 'SingleLineText', isLookup: true, lookupOptions: {linkFieldId: 'fld1', lookupFieldId: 'fld_name'}}
   * - RollupField{id: 'fld3', type: 'Rollup', lookupOptions: {linkFieldId: 'fld1', lookupFieldId: 'fld_count'}}
   *
   * Output:
   * {
   *   linkFieldContexts: [
   *     {
   *       linkField: LinkField{id: 'fld1'},
   *       lookupField: TextField{id: 'fld_name'},
   *       foreignTableName: 'tbl_foreign123'
   *     }
   *   ],
   *   mainTableName: 'tbl_main456',
   *   tableNameMap: Map{'tbl2' => 'tbl_foreign123'},
   *   additionalFields: Map{'fld_count' => CountField{id: 'fld_count'}}
   * }
   *
   * Processing steps:
   * 1. Process direct Link fields (non-lookup)
   * 2. Process Lookup fields and their nested chains
   * 3. Handle lookup-to-link field relationships
   * 4. Collect additional fields needed for rollup calculations
   * 5. Build table name mappings for all referenced tables
   *
   * Future enhancements:
   * - Support for multi-level nested lookups (lookup -> lookup -> link)
   * - Optimization for circular reference detection
   * - Caching of frequently accessed field relationships
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async createLinkFieldContexts(
    fields: IFieldInstance[],
    _tableId: string,
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
   *
   * This method traverses a chain of nested lookup fields to collect all the tables
   * and link fields involved in the relationship. It's crucial for handling complex
   * scenarios where a lookup field points to another lookup field, creating a chain.
   *
   * @param field - The starting lookup field to analyze
   * @param tableNameMap - Map to store table ID -> database table name mappings
   * @param linkFieldContexts - Array to store link field contexts for CTE generation
   *
   * @example
   * Scenario: Table A -> Lookup to Table B -> Lookup to Table C -> Link to Table D
   *
   * Input:
   * - field: LookupField{
   *     id: 'fld_lookup_a',
   *     isLookup: true,
   *     lookupOptions: {
   *       linkFieldId: 'fld_link_b',
   *       lookupFieldId: 'fld_lookup_b',
   *       foreignTableId: 'tbl_b'
   *     }
   *   }
   *
   * Processing chain:
   * 1. Start with fld_lookup_a (points to Table B)
   * 2. Follow to fld_lookup_b in Table B (points to Table C)
   * 3. Follow to fld_link_c in Table C (points to Table D)
   * 4. End at actual Link field
   *
   * Output effects:
   * - tableNameMap updated with: {'tbl_b' => 'tbl_b_123', 'tbl_c' => 'tbl_c_456', 'tbl_d' => 'tbl_d_789'}
   * - linkFieldContexts updated with contexts for each link in the chain
   *
   * Circular reference protection:
   * - Uses visitedFields Set to prevent infinite loops
   * - Breaks chain if same field ID encountered twice
   *
   * Error handling:
   * - Gracefully handles missing tables/fields
   * - Continues processing even if intermediate steps fail
   * - Logs warnings for debugging purposes
   *
   * Future improvements:
   * - Add depth limit for very long chains
   * - Implement caching for frequently traversed chains
   * - Add metrics for chain complexity analysis
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
   * Collect table names and link fields for lookup -> link field relationships
   *
   * This method handles a specific scenario where a lookup field directly targets
   * a link field in another table. This creates a two-hop relationship that requires
   * special handling to ensure proper CTE generation and data access.
   *
   * @param field - The lookup field that potentially targets a link field
   * @param tableNameMap - Map to store table ID -> database table name mappings
   * @param linkFieldContexts - Array to store link field contexts for CTE generation
   *
   * @example
   * Scenario: Table A has a Lookup field that looks up a Link field in Table B
   *
   * Table A:
   * - LookupField{
   *     id: 'fld_lookup_a',
   *     isLookup: true,
   *     lookupOptions: {
   *       linkFieldId: 'fld_link_a_to_b',
   *       lookupFieldId: 'fld_link_b_to_c',  // This is a Link field!
   *       foreignTableId: 'tbl_b'
   *     }
   *   }
   *
   * Table B:
   * - LinkField{
   *     id: 'fld_link_b_to_c',
   *     type: 'Link',
   *     options: {
   *       foreignTableId: 'tbl_c',
   *       lookupFieldId: 'fld_name_c'
   *     }
   *   }
   *
   * Processing:
   * 1. Detect that lookupFieldId points to a Link field
   * 2. Add table mappings for both intermediate table (B) and target table (C)
   * 3. Create link field context for the target Link field
   * 4. Enable proper CTE generation for the nested relationship
   *
   * Output effects:
   * - tableNameMap: {'tbl_b' => 'tbl_b_123', 'tbl_c' => 'tbl_c_456'}
   * - linkFieldContexts: [LinkContext for fld_link_b_to_c]
   * - Debug logs for troubleshooting complex relationships
   *
   * Use cases:
   * - Cross-table link aggregation
   * - Multi-hop data relationships
   * - Complex reporting scenarios
   *
   * Future enhancements:
   * - Support for lookup -> lookup -> link chains
   * - Performance optimization for deep relationships
   * - Better error reporting for broken chains
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
}
