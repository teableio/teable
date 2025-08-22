/* eslint-disable sonarjs/no-duplicated-branches */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Logger } from '@nestjs/common';
import { DriverClient, FieldType, Relationship } from '@teable/core';
import type {
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
  ButtonFieldCore,
  Tables,
  TableDomain,
  ILinkFieldOptions,
  FieldCore,
  IRollupFieldOptions,
} from '@teable/core';
import type { Knex } from 'knex';
import { match } from 'ts-pattern';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
import {
  getLinkUsesJunctionTable,
  getTableAliasFromTable,
} from '../record/query-builder/record-query-builder.util';
import { ID_FIELD_NAME } from './constant';
import { FieldFormattingVisitor } from './field-formatting-visitor';
import { FieldSelectVisitor } from './field-select-visitor';
import type { IFieldSelectName } from './field-select.type';

type ICteResult = void;

const JUNCTION_ALIAS = 'j';

class FieldCteSelectionVisitor implements IFieldVisitor<IFieldSelectName> {
  constructor(
    private readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly table: TableDomain,
    private readonly foreignTable: TableDomain,
    private readonly fieldCteMap: ReadonlyMap<string, string>
  ) {}
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
    targetField: FieldCore
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
        if (targetField.type === FieldType.MultipleSelect) {
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
        return this.dbProvider.driver === DriverClient.Pg
          ? `STRING_AGG(${fieldExpression}::text, ', ' ORDER BY ${JUNCTION_ALIAS}.__id)`
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
  private visitLookupField(field: FieldCore): IFieldSelectName {
    if (!field.isLookup) {
      throw new Error('Not a lookup field');
    }

    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      this.foreignTable,
      this.fieldCteMap
    );

    const targetLookupField = field.mustGetForeignLookupField(this.foreignTable);
    const targetFieldResult = targetLookupField.accept(selectVisitor);

    const expression =
      typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
    if (!field.isMultipleCellValue) {
      return expression;
    }
    return this.getJsonAggregationFunction(expression);
  }
  visitNumberField(field: NumberFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitSingleLineTextField(field: SingleLineTextFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLongTextField(field: LongTextFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitAttachmentField(field: AttachmentFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitCheckboxField(field: CheckboxFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitDateField(field: DateFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitRatingField(field: RatingFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitAutoNumberField(field: AutoNumberFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLinkField(field: LinkFieldCore): IFieldSelectName {
    const foreignTable = this.foreignTable;
    const driver = this.dbProvider.driver;
    const junctionAlias = JUNCTION_ALIAS;

    const targetLookupField = foreignTable.mustGetField(field.options.lookupFieldId);
    const usesJunctionTable = getLinkUsesJunctionTable(field);
    const foreignTableAlias = getTableAliasFromTable(foreignTable);
    const isMultiValue = field.getIsMultiValue();
    const hasOrderColumn = field.getHasOrderColumn();

    // Use table alias for cleaner SQL
    const recordIdRef = `"${foreignTableAlias}"."${ID_FIELD_NAME}"`;

    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      foreignTable,
      this.fieldCteMap
    );
    const targetFieldResult = targetLookupField.accept(selectVisitor);
    let targetFieldSelectionExpression =
      typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;

    // Apply field formatting if targetLookupField is provided
    const formattingVisitor = new FieldFormattingVisitor(targetFieldSelectionExpression, driver);
    targetFieldSelectionExpression = targetLookupField.accept(formattingVisitor);

    // Determine if this relationship should return multiple values (array) or single value (object)
    return match(driver)
      .with(DriverClient.Pg, () => {
        // Build JSON object with id and title, preserving null titles for formula fields
        // Use COALESCE to ensure title is never completely null (empty string instead)
        const conditionalJsonObject = `jsonb_build_object('id', ${recordIdRef}, 'title', COALESCE(${targetFieldSelectionExpression}, ''))::json`;

        if (isMultiValue) {
          // Filter out null records and return empty array if no valid records exist
          // Order by junction table __id if available (for consistent insertion order)
          // For relationships without junction table, use the order column if field has order column

          const orderByField = match({ usesJunctionTable, hasOrderColumn })
            .with({ usesJunctionTable: true, hasOrderColumn: true }, () => {
              // ManyMany relationship: use junction table order column if available
              const linkField = field as LinkFieldCore;
              return `${junctionAlias}."${linkField.getOrderColumnName()}"`;
            })
            .with({ usesJunctionTable: true, hasOrderColumn: false }, () => {
              // ManyMany relationship: use junction table __id
              return `${junctionAlias}."__id"`;
            })
            .with({ usesJunctionTable: false, hasOrderColumn: true }, () => {
              // OneMany/ManyOne/OneOne relationship: use the order column in the foreign key table
              const linkField = field as LinkFieldCore;
              return `${foreignTableAlias}."${linkField.getOrderColumnName()}"`;
            })
            .with({ usesJunctionTable: false, hasOrderColumn: false }, () => recordIdRef) // Fallback to record ID if no order column is available
            .exhaustive();

          return `COALESCE(json_agg(${conditionalJsonObject} ORDER BY ${orderByField}) FILTER (WHERE ${recordIdRef} IS NOT NULL), '[]'::json)`;
        } else {
          // For single value relationships (ManyOne, OneOne), return single object or null
          return `CASE WHEN ${recordIdRef} IS NOT NULL THEN ${conditionalJsonObject} ELSE NULL END`;
        }
      })
      .with(DriverClient.Sqlite, () => {
        // Create conditional JSON object that only includes title if it's not null
        const conditionalJsonObject = `CASE
          WHEN ${targetFieldSelectionExpression} IS NOT NULL THEN json_object('id', ${recordIdRef}, 'title', ${targetFieldSelectionExpression})
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
      })
      .otherwise(() => {
        throw new Error(`Unsupported database driver: ${driver}`);
      });
  }
  visitRollupField(field: RollupFieldCore): IFieldSelectName {
    const targetField = field.mustGetForeignLookupField(this.foreignTable);
    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      this.foreignTable,
      this.fieldCteMap
    );

    const targetLookupField = field.mustGetForeignLookupField(this.foreignTable);
    const targetFieldResult = targetLookupField.accept(selectVisitor);

    const expression =
      typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
    const rollupOptions = field.options as IRollupFieldOptions;
    const linkField = field.getLinkField(this.table);
    const options = linkField?.options as ILinkFieldOptions;
    const isSingleValueRelationship =
      options.relationship === Relationship.ManyOne || options.relationship === Relationship.OneOne;
    return isSingleValueRelationship
      ? this.generateSingleValueRollupAggregation(rollupOptions.expression, expression)
      : this.generateRollupAggregation(rollupOptions.expression, expression, targetField);
  }
  visitSingleSelectField(field: SingleSelectFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitMultipleSelectField(field: MultipleSelectFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitFormulaField(field: FormulaFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitCreatedTimeField(field: CreatedTimeFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLastModifiedTimeField(field: LastModifiedTimeFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitUserField(field: UserFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitCreatedByField(field: CreatedByFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitLastModifiedByField(field: LastModifiedByFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
  visitButtonField(field: ButtonFieldCore): IFieldSelectName {
    return this.visitLookupField(field);
  }
}

export class FieldCteVisitor implements IFieldVisitor<ICteResult> {
  private logger = new Logger(FieldCteVisitor.name);

  static generateCTENameForField(table: TableDomain, field: LinkFieldCore) {
    return `CTE_${getTableAliasFromTable(table)}_${field.id}`;
  }

  private readonly _table: TableDomain;
  private readonly _fieldCteMap: Map<string, string>;

  constructor(
    public readonly qb: Knex.QueryBuilder,
    private readonly dbProvider: IDbProvider,
    private readonly tables: Tables
  ) {
    this._fieldCteMap = new Map();
    this._table = tables.mustGetEntryTable();
  }

  get table() {
    return this._table;
  }

  get fieldCteMap(): ReadonlyMap<string, string> {
    return this._fieldCteMap;
  }

  public build() {
    for (const field of this.table.fields) {
      field.accept(this);
    }
  }

  private generateLinkFieldCte(linkField: LinkFieldCore): void {
    const foreignTable = this.tables.mustGetLinkForeignTable(linkField);
    const cteName = FieldCteVisitor.generateCTENameForField(this.table, linkField);
    const usesJunctionTable = getLinkUsesJunctionTable(linkField);
    const options = linkField.options as ILinkFieldOptions;
    const mainAlias = getTableAliasFromTable(this.table);
    const foreignAlias = getTableAliasFromTable(foreignTable);
    const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

    this.qb
      // eslint-disable-next-line sonarjs/cognitive-complexity
      .with(cteName, (cqb) => {
        const visitor = new FieldCteSelectionVisitor(
          cqb,
          this.dbProvider,
          this.table,
          foreignTable,
          this.fieldCteMap
        );
        const linkValue = linkField.accept(visitor);

        cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
        cqb.select(cqb.client.raw(`${linkValue} as link_value`));

        const lookupFields = linkField.getLookupFields(this.table);

        for (const lookupField of lookupFields) {
          const visitor = new FieldCteSelectionVisitor(
            cqb,
            this.dbProvider,
            this.table,
            foreignTable,
            this.fieldCteMap
          );
          const lookupValue = lookupField.accept(visitor);
          cqb.select(cqb.client.raw(`${lookupValue} as "lookup_${lookupField.id}"`));
        }

        const rollupFields = linkField.getRollupFields(this.table);
        for (const rollupField of rollupFields) {
          const visitor = new FieldCteSelectionVisitor(
            cqb,
            this.dbProvider,
            this.table,
            foreignTable,
            this.fieldCteMap
          );
          const rollupValue = rollupField.accept(visitor);
          cqb.select(cqb.client.raw(`${rollupValue} as "rollup_${rollupField.id}"`));
        }

        if (usesJunctionTable) {
          cqb
            .from(`${this.table.dbTableName} as ${mainAlias}`)
            .leftJoin(
              `${fkHostTableName} as ${JUNCTION_ALIAS}`,
              `${mainAlias}.__id`,
              `${JUNCTION_ALIAS}.${selfKeyName}`
            )
            .leftJoin(
              `${foreignTable.dbTableName} as ${foreignAlias}`,
              `${JUNCTION_ALIAS}.${foreignKeyName}`,
              `${foreignAlias}.__id`
            )
            .groupBy(`${mainAlias}.__id`);

          // For SQLite, add ORDER BY at query level since json_group_array doesn't support internal ordering
          if (this.dbProvider.driver === DriverClient.Sqlite) {
            cqb.orderBy(`${JUNCTION_ALIAS}.__id`);
          }
        } else if (relationship === Relationship.OneMany) {
          // For non-one-way OneMany relationships, foreign key is stored in the foreign table
          // No junction table needed

          cqb
            .from(`${this.table.dbTableName} as ${mainAlias}`)
            .leftJoin(
              `${foreignTable.dbTableName} as ${foreignAlias}`,
              `${mainAlias}.__id`,
              `${foreignAlias}.${selfKeyName}`
            )
            .groupBy(`${mainAlias}.__id`);

          // For SQLite, add ORDER BY at query level
          if (this.dbProvider.driver === DriverClient.Sqlite) {
            if (linkField.getHasOrderColumn()) {
              cqb.orderBy(`${foreignAlias}.${selfKeyName}_order`);
            } else {
              cqb.orderBy(`${foreignAlias}.__id`);
            }
          }
        } else if (relationship === Relationship.ManyOne || relationship === Relationship.OneOne) {
          // Direct join for many-to-one and one-to-one relationships
          // No GROUP BY needed for single-value relationships

          // For OneOne and ManyOne relationships, the foreign key is always stored in fkHostTableName
          // But we need to determine the correct join condition based on which table we're querying from
          const isForeignKeyInMainTable = fkHostTableName === this.table.dbTableName;

          cqb.from(`${this.table.dbTableName} as ${mainAlias}`);

          if (isForeignKeyInMainTable) {
            // Foreign key is stored in the main table (original field case)
            // Join: main_table.foreign_key_column = foreign_table.__id
            cqb.leftJoin(
              `${foreignTable.dbTableName} as ${foreignAlias}`,
              `${mainAlias}.${foreignKeyName}`,
              `${foreignAlias}.__id`
            );
          } else {
            // Foreign key is stored in the foreign table (symmetric field case)
            // Join: foreign_table.foreign_key_column = main_table.__id
            // Note: for symmetric fields, selfKeyName and foreignKeyName are swapped
            cqb.leftJoin(
              `${foreignTable.dbTableName} as ${foreignAlias}`,
              `${foreignAlias}.${selfKeyName}`,
              `${mainAlias}.__id`
            );
          }
        }
      })
      .leftJoin(cteName, `${mainAlias}.${ID_FIELD_NAME}`, `${cteName}.main_record_id`);

    this._fieldCteMap.set(linkField.id, cteName);
  }

  visitNumberField(_field: NumberFieldCore): void {}
  visitSingleLineTextField(_field: SingleLineTextFieldCore): void {}
  visitLongTextField(_field: LongTextFieldCore): void {}
  visitAttachmentField(_field: AttachmentFieldCore): void {}
  visitCheckboxField(_field: CheckboxFieldCore): void {}
  visitDateField(_field: DateFieldCore): void {}
  visitRatingField(_field: RatingFieldCore): void {}
  visitAutoNumberField(_field: AutoNumberFieldCore): void {}
  visitLinkField(field: LinkFieldCore): void {
    return this.generateLinkFieldCte(field);
  }
  visitRollupField(_field: RollupFieldCore): void {}
  visitSingleSelectField(_field: SingleSelectFieldCore): void {}
  visitMultipleSelectField(_field: MultipleSelectFieldCore): void {}
  visitFormulaField(_field: FormulaFieldCore): void {}
  visitCreatedTimeField(_field: CreatedTimeFieldCore): void {}
  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): void {}
  visitUserField(_field: UserFieldCore): void {}
  visitCreatedByField(_field: CreatedByFieldCore): void {}
  visitLastModifiedByField(_field: LastModifiedByFieldCore): void {}
  visitButtonField(_field: ButtonFieldCore): void {}
}
