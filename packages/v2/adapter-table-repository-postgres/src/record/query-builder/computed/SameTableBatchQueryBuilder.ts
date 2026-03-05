import { domainError, FieldType, FieldValueTypeVisitor } from '@teable/v2-core';
import type {
  ConditionalLookupField,
  DomainError,
  Field,
  FieldId,
  FormulaField,
  LookupField,
  Table,
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
import { CteLevelSqlPlan, FormulaFieldSqlFragment } from './SameTableBatchSqlPlan';

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
 * Strategy:
 * 1. Build level CTEs in dependency order.
 * 2. Carry forward previous computed columns into every later CTE.
 * 3. Final SELECT reads from the last CTE only.
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
        const cteChain = yield* this.buildCteChain(config.table, fieldsByLevel);

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
    fieldsByLevel: Map<number, Field[]>
  ): Result<CteChain, DomainError> {
    return safeTry<CteChain, DomainError>(
      function* (this: SameTableBatchQueryBuilder) {
        const ctes: CteLevelSqlPlan[] = [];
        const levels = [...fieldsByLevel.keys()].sort((a, b) => a - b);

        // Track which columns are available from previous CTEs
        const previousCteColumns = new Map<string, { cteName: string; columnName: string }>();

        for (const level of levels) {
          const fields = fieldsByLevel.get(level) ?? [];
          if (fields.length === 0) continue;

          const cteName = `level_${level}`;
          const levelFieldIds = new Set(fields.map((field) => field.id().toString()));

          const carryForwardFragments: FormulaFieldSqlFragment[] = [];
          for (const [fieldId, cteColumn] of previousCteColumns.entries()) {
            if (levelFieldIds.has(fieldId)) continue;
            carryForwardFragments.push(
              FormulaFieldSqlFragment.create({
                fieldId,
                columnAlias: cteColumn.columnName,
                expressionSql: `"${cteColumn.cteName}"."${cteColumn.columnName}"`,
                cseEligible: false,
              })
            );
          }

          const computedFragments: FormulaFieldSqlFragment[] = [];
          const computedColumns: Array<{ fieldId: string; columnName: string }> = [];

          // Build select expressions for each field in this level
          for (const field of fields) {
            const columnName = yield* this.getColumnName(field);
            const expr = yield* this.buildFieldExpression(table, field, previousCteColumns);

            computedFragments.push(
              FormulaFieldSqlFragment.create({
                fieldId: field.id().toString(),
                columnAlias: columnName,
                expressionSql: expr.compile(this.db).sql,
                cseEligible: field.type().equals(FieldType.formula()),
              })
            );
            computedColumns.push({ fieldId: field.id().toString(), columnName });
          }

          ctes.push(
            CteLevelSqlPlan.create({
              name: cteName,
              level,
              fragments: [...carryForwardFragments, ...computedFragments],
              previousCteName: ctes.length > 0 ? ctes[ctes.length - 1].name : undefined,
            })
          );

          // Every previously computed column is now available through this CTE via carry-forward.
          for (const [fieldId, column] of [...previousCteColumns.entries()]) {
            previousCteColumns.set(fieldId, { cteName, columnName: column.columnName });
          }
          for (const column of computedColumns) {
            previousCteColumns.set(column.fieldId, { cteName, columnName: column.columnName });
          }
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
        this.resolveFieldSqlWithCte(table, refField, previousCteColumns),
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
    table: Table,
    field: Field,
    previousCteColumns: Map<string, { cteName: string; columnName: string }>,
    formulaMetadataStack = new Set<string>()
  ): Result<SqlExpr, DomainError> {
    const fieldIdStr = field.id().toString();
    const cteInfo = previousCteColumns.get(fieldIdStr);

    if (cteInfo) {
      // This field was computed in a previous CTE - reference that value
      const ref = `"${cteInfo.cteName}"."${cteInfo.columnName}"`;
      const typing = this.resolveFieldTyping(field);
      if (field.type().equals(FieldType.formula()) && !formulaMetadataStack.has(fieldIdStr)) {
        const nextStack = new Set(formulaMetadataStack);
        nextStack.add(fieldIdStr);
        const metadataResult = this.resolveFormulaMetadataWithCte(
          table,
          field as FormulaField,
          previousCteColumns,
          nextStack
        );
        if (metadataResult.isOk()) {
          return ok(
            makeExpr(
              ref,
              typing.valueType,
              typing.isArray,
              metadataResult.value.errorConditionSql,
              metadataResult.value.errorMessageSql
            )
          );
        }
      }

      return ok(makeExpr(ref, typing.valueType, typing.isArray));
    }

    // Field is from the main table
    return this.getColumnName(field).map((colName) => {
      const ref = `"${T}"."${colName}"`;

      // Handle lookup and conditionalLookup fields using their real multiplicity.
      // Scalar lookups are stored as scalar DB columns and must not be forced
      // through array/json coercion paths.
      if (field.type().equals(FieldType.lookup())) {
        const lookupField = field as LookupField;
        const typing = this.resolveFieldTyping(field);
        const innerFieldResult = lookupField.innerField();
        const valueType = innerFieldResult.isOk()
          ? this.mapFieldTypeToValueType(innerFieldResult.value.type())
          : typing.valueType;
        return makeExpr(
          ref,
          valueType,
          typing.isArray,
          undefined,
          undefined,
          lookupField,
          typing.isArray ? 'array' : 'scalar'
        );
      }

      if (field.type().equals(FieldType.conditionalLookup())) {
        const conditionalLookupField = field as ConditionalLookupField;
        const typing = this.resolveFieldTyping(field);
        const innerFieldResult = conditionalLookupField.innerField();
        const valueType = innerFieldResult.isOk()
          ? this.mapFieldTypeToValueType(innerFieldResult.value.type())
          : typing.valueType;
        return makeExpr(
          ref,
          valueType,
          typing.isArray,
          undefined,
          undefined,
          conditionalLookupField,
          typing.isArray ? 'array' : 'scalar'
        );
      }

      const typing = this.resolveFieldTyping(field);
      return makeExpr(ref, typing.valueType, typing.isArray);
    });
  }

  private resolveFormulaMetadataWithCte(
    table: Table,
    formulaField: FormulaField,
    previousCteColumns: Map<string, { cteName: string; columnName: string }>,
    formulaMetadataStack: Set<string>
  ): Result<SqlExpr, DomainError> {
    const translator = new FormulaSqlPgTranslator({
      table,
      tableAlias: T,
      resolveFieldSql: (refField: Field) =>
        this.resolveFieldSqlWithCte(table, refField, previousCteColumns, formulaMetadataStack),
      // Keep formula references bound to CTE columns; we only need error metadata here.
      skipFormulaExpansion: true,
      typeValidationStrategy: this.typeValidationStrategy,
      timeZone: formulaField.timeZone()?.toString(),
    });

    return translator.translateExpression(formulaField.expression().toString());
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

  private resolveFieldTyping(field: Field): { valueType: SqlValueType; isArray: boolean } {
    const valueTypeResult = field.accept(new FieldValueTypeVisitor());
    if (valueTypeResult.isErr()) {
      return {
        valueType: this.mapFieldTypeToValueType(field.type()),
        isArray: false,
      };
    }

    return {
      valueType: this.mapCellValueTypeToSqlValueType(
        valueTypeResult.value.cellValueType.toString()
      ),
      isArray: valueTypeResult.value.isMultipleCellValue.toBoolean(),
    };
  }

  private mapCellValueTypeToSqlValueType(
    cellValueType: 'string' | 'number' | 'boolean' | 'dateTime'
  ): SqlValueType {
    switch (cellValueType) {
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'dateTime':
        return 'datetime';
      default:
        return 'string';
    }
  }

  /**
   * Build the final query that combines all CTEs and produces the SELECT for UPDATE.
   */
  private buildUpdateQuery(
    tableName: string,
    cteChain: CteChain,
    recordIds: ReadonlyArray<string>,
    dirtyFilter?: SameTableBatchConfig['dirtyFilter']
  ): Result<UpdateQueryResult, DomainError> {
    const ctes = cteChain.ctes;
    if (ctes.length === 0) {
      return err(domainError.validation({ message: 'No CTEs generated for batch update' }));
    }
    const lastCte = ctes[ctes.length - 1];
    const qualifiedTableName = quoteQualifiedTableName(tableName);

    // Because each level carries forward prior columns, every target column can be read from the last CTE.
    const mappedColumnSet = new Set<string>();
    const fieldMappings: FieldMapping[] = [];
    for (const cte of ctes) {
      for (const fragment of cte.fragments) {
        if (mappedColumnSet.has(fragment.columnAlias)) continue;
        mappedColumnSet.add(fragment.columnAlias);
        fieldMappings.push({
          columnName: fragment.columnAlias,
          cteName: lastCte.name,
        });
      }
    }

    // Build CTEs as raw SQL
    const cteDefinitions: string[] = [];
    for (const cte of ctes) {
      let fromClause: string;
      if (cte.previousCteName) {
        // Join with main table and previous CTE
        fromClause = `FROM ${qualifiedTableName} AS "${T}" JOIN "${cte.previousCteName}" ON "${T}"."__id" = "${cte.previousCteName}"."__id"`;
      } else {
        // First level - select from main table with optional dirty filter + explicit record slicing.
        const dirtyJoin = (() => {
          if (!dirtyFilter) return '';
          const dirtyTableName = dirtyFilter.dirtyTableName ?? 'tmp_computed_dirty';
          const tableIdColumn = dirtyFilter.tableIdColumn ?? 'table_id';
          const recordIdColumn = dirtyFilter.recordIdColumn ?? 'record_id';
          // Note: tableId is a trusted internal ID, embedded as a SQL literal.
          const tableIdLiteral = escapeSqlLiteral(dirtyFilter.tableId);
          return ` INNER JOIN "${dirtyTableName}" AS "__dirty" ON "${T}"."__id" = "__dirty"."${recordIdColumn}" AND "__dirty"."${tableIdColumn}" = '${tableIdLiteral}'`;
        })();

        const recordIdsJoin =
          recordIds.length > 0
            ? ` INNER JOIN (VALUES ${recordIds
                .map((recordId) => `('${escapeSqlLiteral(recordId)}')`)
                .join(', ')}) AS "__record_ids"("__id") ON "${T}"."__id" = "__record_ids"."__id"`
            : '';

        fromClause = `FROM ${qualifiedTableName} AS "${T}"${dirtyJoin}${recordIdsJoin}`;
      }

      const cteDef = cte.buildCteSql(fromClause);
      cteDefinitions.push(cteDef);
    }

    // Build final SELECT from the last CTE only (earlier levels are carried forward).
    const cteNames = ctes.map((c) => c.name);
    const finalSelectCols = ['u."__id"'];
    for (const mapping of fieldMappings) {
      finalSelectCols.push(
        `"${mapping.cteName}"."${mapping.columnName}" as "${mapping.columnName}"`
      );
    }

    const cteClause = `WITH ${cteDefinitions.join(', ')}`;
    const selectClause = `SELECT ${finalSelectCols.join(', ')}`;
    const fromClause = `FROM ${qualifiedTableName} AS u JOIN "${lastCte.name}" ON u."__id" = "${lastCte.name}"."__id"`;
    const fullSql = `${cteClause} ${selectClause} ${fromClause}`;
    // Wrap WITH query as a derived table source; callers use selectQuery.as(...)
    // and PostgreSQL requires WITH to be inside parentheses in that position.
    const selectQuery = sql.raw(`(${fullSql})`) as unknown as QB;

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

const escapeSqlLiteral = (value: string): string => value.replaceAll("'", "''");
const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const quoteQualifiedTableName = (tableName: string): string =>
  tableName
    .split('.')
    .map((part) => quoteIdentifier(part))
    .join('.');

type CteChain = {
  ctes: CteLevelSqlPlan[];
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
