import { domainError, FieldType } from '@teable/v2-core';
import type {
  FieldId,
  DomainError,
  Field,
  FormulaField,
  Table,
  ConditionalLookupField,
  LookupField,
} from '@teable/v2-core';
import {
  FormulaSqlPgTranslator,
  guardValueSql,
  makeExpr,
  type IPgTypeValidationStrategy,
  type SqlExpr,
  type SqlValueType,
} from '@teable/v2-formula-sql-pg';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import { FieldOutputColumnVisitor } from '../FieldOutputColumnVisitor';
import type { DynamicDB, QB } from '../ITableRecordQueryBuilder';

/**
 * A level of same-table fields to compute.
 * Fields within the same level have no inter-dependencies.
 */
export type SameTableFieldLevel = {
  level: number;
  fieldIds: ReadonlyArray<FieldId>;
};

/**
 * Configuration for same-table batch computation.
 */
export type SameTableBatchConfig = {
  /** The table to compute fields for */
  table: Table;
  /** Field levels ordered by dependency (earlier levels are dependencies of later ones) */
  fieldLevels: ReadonlyArray<SameTableFieldLevel>;
  /** Optional: filter to specific record IDs */
  recordIds?: ReadonlyArray<string>;
  /**
   * Optional: filter to dirty records by joining the temporary dirty table.
   * This is required when using the batch builder inside computed updates.
   */
  dirtyFilter?: {
    tableId: string;
    dirtyTableName?: string;
    tableIdColumn?: string;
    recordIdColumn?: string;
  };
};

const T = 't'; // main table alias

/**
 * Query builder for batching same-table formula computations using CTEs.
 *
 * When multiple formulas in the same table depend on each other:
 * - Formula B = A + 1
 * - Formula C = B * 2
 * - Formula D = C + 3
 *
 * Instead of 3 separate UPDATE statements, we build a single UPDATE using CTEs:
 *
 * ```sql
 * WITH
 *   level_0 AS (
 *     SELECT __id, (A + 1) as B_col FROM table_name
 *   ),
 *   level_1 AS (
 *     SELECT t.__id, (level_0.B_col * 2) as C_col
 *     FROM table_name t
 *     JOIN level_0 ON t.__id = level_0.__id
 *   ),
 *   level_2 AS (
 *     SELECT t.__id, (level_1.C_col + 3) as D_col
 *     FROM table_name t
 *     JOIN level_1 ON t.__id = level_1.__id
 *   )
 * UPDATE table_name u
 * SET
 *   B_col = level_0.B_col,
 *   C_col = level_1.C_col,
 *   D_col = level_2.D_col
 * FROM level_0, level_1, level_2
 * WHERE u.__id = level_0.__id
 *   AND u.__id = level_1.__id
 *   AND u.__id = level_2.__id
 * ```
 *
 * This approach:
 * 1. Ensures each level sees computed values from previous levels
 * 2. Executes all updates in a single statement
 * 3. Avoids multiple table scans
 */
export class SameTableBatchQueryBuilder {
  private readonly columnVisitor = new FieldOutputColumnVisitor();

  constructor(
    private readonly db: Kysely<DynamicDB>,
    private readonly typeValidationStrategy: IPgTypeValidationStrategy
  ) {}

  /**
   * Build the CTE-based batch update query.
   */
  build(config: SameTableBatchConfig): Result<SameTableBatchResult, DomainError> {
    if (config.fieldLevels.length === 0) {
      return err(domainError.validation({ message: 'No field levels provided for batch update' }));
    }

    return safeTry<SameTableBatchResult, DomainError>(
      function* (this: SameTableBatchQueryBuilder) {
        const dbTableNameVO = yield* config.table.dbTableName();
        const tableName = yield* dbTableNameVO.value();

        // Collect all field metadata we need
        const fieldsByLevel = yield* this.collectFieldsByLevel(config.table, config.fieldLevels);

        // Build the CTE chain
        const cteChain = yield* this.buildCteChain(config.table, tableName, fieldsByLevel);

        // Build the final UPDATE statement
        const updateQuery = yield* this.buildUpdateQuery(
          tableName,
          cteChain,
          config.recordIds ?? [],
          config.dirtyFilter
        );

        return ok({
          selectQuery: updateQuery.selectQuery,
          cteNames: updateQuery.cteNames,
          fieldMappings: updateQuery.fieldMappings,
          tableName,
        });
      }.bind(this)
    );
  }

  /**
   * Collect field objects organized by level.
   */
  private collectFieldsByLevel(
    table: Table,
    fieldLevels: ReadonlyArray<SameTableFieldLevel>
  ): Result<Map<number, Field[]>, DomainError> {
    return safeTry<Map<number, Field[]>, DomainError>(function* () {
      const result = new Map<number, Field[]>();

      for (const level of fieldLevels) {
        const fields: Field[] = [];
        for (const fieldId of level.fieldIds) {
          const field = yield* table.getField((f) => f.id().equals(fieldId));
          fields.push(field);
        }
        result.set(level.level, fields);
      }

      return ok(result);
    });
  }

  /**
   * Build the CTE chain where each level can reference computed values from previous levels.
   */
  private buildCteChain(
    table: Table,
    tableName: string,
    fieldsByLevel: Map<number, Field[]>
  ): Result<CteChain, DomainError> {
    return safeTry<CteChain, DomainError>(
      function* (this: SameTableBatchQueryBuilder) {
        const ctes: CteDefinition[] = [];
        const levels = [...fieldsByLevel.keys()].sort((a, b) => a - b);

        // Track which columns are available from previous CTEs
        const previousCteColumns = new Map<string, { cteName: string; columnName: string }>();

        for (const level of levels) {
          const fields = fieldsByLevel.get(level) ?? [];
          if (fields.length === 0) continue;

          const cteName = `level_${level}`;
          const selectExprs: Array<{ alias: string; expr: RawBuilder<unknown> }> = [];

          // Build select expressions for each field in this level
          for (const field of fields) {
            const columnName = yield* this.getColumnName(field);
            const expr = yield* this.buildFieldExpression(
              table,
              field,
              tableName,
              previousCteColumns
            );
            selectExprs.push({ alias: columnName, expr });

            // Register this column for future levels
            previousCteColumns.set(field.id().toString(), { cteName, columnName });
          }

          ctes.push({
            name: cteName,
            level,
            selectExprs,
            previousCteName: ctes.length > 0 ? ctes[ctes.length - 1].name : undefined,
          });
        }

        return ok({
          ctes,
          previousCteColumns,
        });
      }.bind(this)
    );
  }

  /**
   * Build a SQL expression for a field, referencing previous CTE computed values where needed.
   */
  private buildFieldExpression(
    table: Table,
    field: Field,
    tableName: string,
    previousCteColumns: Map<string, { cteName: string; columnName: string }>
  ): Result<RawBuilder<unknown>, DomainError> {
    // Only formula fields can have same-table dependencies
    if (!field.type().equals(FieldType.formula())) {
      // For non-formula computed fields (link/lookup/rollup), we just copy from main table
      return this.getColumnName(field).map((colName) => sql`${sql.ref(`${T}.${colName}`)}`);
    }

    const formulaField = field as FormulaField;

    // Build translator with custom field resolver that checks CTE columns
    // Use skipFormulaExpansion to prevent recursive formula expansion -
    // formula fields from previous CTE levels should reference CTE columns directly
    const translator = new FormulaSqlPgTranslator({
      table,
      tableAlias: T,
      resolveFieldSql: (refField: Field) =>
        this.resolveFieldSqlWithCte(refField, previousCteColumns, tableName),
      skipFormulaExpansion: true,
      typeValidationStrategy: this.typeValidationStrategy,
      timeZone: formulaField.timeZone()?.toString(),
    });

    const translated = translator.translateExpression(formulaField.expression().toString());
    if (translated.isErr()) {
      return ok(sql.raw('NULL'));
    }

    const expr = translated.value;
    const typedSql = guardValueSql(expr.valueSql, expr.errorConditionSql);
    return ok(sql.raw(typedSql));
  }

  /**
   * Resolve a field reference to SQL, checking if it should come from a previous CTE.
   */
  private resolveFieldSqlWithCte(
    field: Field,
    previousCteColumns: Map<string, { cteName: string; columnName: string }>,
    _tableName: string
  ): Result<SqlExpr, DomainError> {
    const fieldIdStr = field.id().toString();
    const cteInfo = previousCteColumns.get(fieldIdStr);

    if (cteInfo) {
      // This field was computed in a previous CTE - reference that value
      const ref = `"${cteInfo.cteName}"."${cteInfo.columnName}"`;
      return ok(makeExpr(ref, 'unknown', false));
    }

    // Field is from the main table
    return this.getColumnName(field).map((colName) => {
      const ref = `"${T}"."${colName}"`;

      // Handle lookup and conditionalLookup fields that return arrays
      if (field.type().equals(FieldType.lookup())) {
        const lookupField = field as LookupField;
        const innerFieldResult = lookupField.innerField();
        const valueType = innerFieldResult.isOk()
          ? this.mapFieldTypeToValueType(innerFieldResult.value.type())
          : 'unknown';
        return makeExpr(ref, valueType, true, undefined, undefined, lookupField, 'array');
      }

      if (field.type().equals(FieldType.conditionalLookup())) {
        const conditionalLookupField = field as ConditionalLookupField;
        const innerFieldResult = conditionalLookupField.innerField();
        const valueType = innerFieldResult.isOk()
          ? this.mapFieldTypeToValueType(innerFieldResult.value.type())
          : 'unknown';
        return makeExpr(
          ref,
          valueType,
          true,
          undefined,
          undefined,
          conditionalLookupField,
          'array'
        );
      }

      return makeExpr(ref, 'unknown', false);
    });
  }

  /**
   * Map a FieldType to a SqlValueType for proper type coercion in formulas.
   */
  private mapFieldTypeToValueType(fieldType: FieldType): SqlValueType {
    if (
      fieldType.equals(FieldType.number()) ||
      fieldType.equals(FieldType.autoNumber()) ||
      fieldType.equals(FieldType.rating())
    ) {
      return 'number';
    }
    if (fieldType.equals(FieldType.checkbox())) {
      return 'boolean';
    }
    if (
      fieldType.equals(FieldType.date()) ||
      fieldType.equals(FieldType.createdTime()) ||
      fieldType.equals(FieldType.lastModifiedTime())
    ) {
      return 'datetime';
    }
    return 'string';
  }

  /**
   * Build the final query that combines all CTEs and produces the SELECT for UPDATE.
   */
  private buildUpdateQuery(
    tableName: string,
    cteChain: CteChain,
    _recordIds: ReadonlyArray<string>,
    dirtyFilter?: SameTableBatchConfig['dirtyFilter']
  ): Result<UpdateQueryResult, DomainError> {
    const ctes = cteChain.ctes;
    if (ctes.length === 0) {
      return err(domainError.validation({ message: 'No CTEs generated for batch update' }));
    }

    // Build the field mappings for the UPDATE SET clause
    const fieldMappings: FieldMapping[] = [];
    for (const cte of ctes) {
      for (const selectExpr of cte.selectExprs) {
        fieldMappings.push({
          columnName: selectExpr.alias,
          cteName: cte.name,
        });
      }
    }

    // Build CTEs as raw SQL
    const cteDefinitions: string[] = [];
    for (const cte of ctes) {
      const selectCols = cte.selectExprs.map(
        (se) => `(${se.expr.compile(this.db).sql}) as "${se.alias}"`
      );

      let fromClause: string;
      if (cte.previousCteName) {
        // Join with main table and previous CTE
        fromClause = `FROM "${tableName}" AS "${T}" JOIN "${cte.previousCteName}" ON "${T}"."__id" = "${cte.previousCteName}"."__id"`;
      } else {
        // First level - just select from main table
        const dirtyJoin = (() => {
          if (!dirtyFilter) return '';
          const dirtyTableName = dirtyFilter.dirtyTableName ?? 'tmp_computed_dirty';
          const tableIdColumn = dirtyFilter.tableIdColumn ?? 'table_id';
          const recordIdColumn = dirtyFilter.recordIdColumn ?? 'record_id';
          // Note: tableId is a trusted internal ID, embedded as a SQL literal.
          const tableIdLiteral = dirtyFilter.tableId.replaceAll("'", "''");
          return ` INNER JOIN "${dirtyTableName}" AS "__dirty" ON "${T}"."__id" = "__dirty"."${recordIdColumn}" AND "__dirty"."${tableIdColumn}" = '${tableIdLiteral}'`;
        })();
        fromClause = `FROM "${tableName}" AS "${T}"${dirtyJoin}`;
      }

      const cteDef = `"${cte.name}" AS (SELECT "${T}"."__id", ${selectCols.join(', ')} ${fromClause})`;
      cteDefinitions.push(cteDef);
    }

    // Build final SELECT that joins all CTEs
    const cteNames = ctes.map((c) => c.name);
    const finalSelectCols = ['u."__id"'];
    for (const mapping of fieldMappings) {
      finalSelectCols.push(
        `"${mapping.cteName}"."${mapping.columnName}" as "${mapping.columnName}"`
      );
    }

    const joinConditions = cteNames.map((name) => `u."__id" = "${name}"."__id"`).join(' AND ');

    const cteClause = `WITH ${cteDefinitions.join(', ')}`;
    const selectClause = `SELECT ${finalSelectCols.join(', ')}`;
    const fromClause = `FROM "${tableName}" AS u, ${cteNames.map((n) => `"${n}"`).join(', ')}`;
    const whereClause = `WHERE ${joinConditions}`;

    const fullSql = `${cteClause} ${selectClause} ${fromClause} ${whereClause}`;
    const selectQuery = sql.raw(fullSql) as unknown as QB;

    return ok({
      selectQuery,
      cteNames,
      fieldMappings,
    });
  }

  private getColumnName(field: Field): Result<string, DomainError> {
    return this.columnVisitor.getColumnAlias(field);
  }
}

type CteDefinition = {
  name: string;
  level: number;
  selectExprs: Array<{ alias: string; expr: RawBuilder<unknown> }>;
  previousCteName?: string;
};

type CteChain = {
  ctes: CteDefinition[];
  previousCteColumns: Map<string, { cteName: string; columnName: string }>;
};

type FieldMapping = {
  columnName: string;
  cteName: string;
};

type UpdateQueryResult = {
  selectQuery: QB;
  cteNames: string[];
  fieldMappings: FieldMapping[];
};

export type SameTableBatchResult = {
  /** The SELECT query with CTEs that produces computed values */
  selectQuery: QB;
  /** Names of CTEs in the query */
  cteNames: string[];
  /** Mapping from column names to their source CTE */
  fieldMappings: FieldMapping[];
  /** The table name being updated */
  tableName: string;
};
