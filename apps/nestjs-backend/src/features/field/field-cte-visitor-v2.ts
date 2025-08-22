/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Logger } from '@nestjs/common';
import { DriverClient, Relationship } from '@teable/core';
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

type ICteResult = void;

const JUNCTION_ALIAS = 'j';

export class FieldCteVisitor implements IFieldVisitor<ICteResult> {
  private logger = new Logger(FieldCteVisitor.name);

  static generateCTENameForField(table: TableDomain, field: LinkFieldCore) {
    return `CTE_${getTableAliasFromTable(table)}_${field.id}`;
  }

  private readonly _table: TableDomain;
  private readonly _fieldCteMap: Map<string, string>;

  constructor(
    private readonly qb: Knex.QueryBuilder,
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
   * Generate JSON aggregation function for Link fields (creates objects with id and title)
   * When title is null, only includes the id key
   * @param field The link field to generate the CTE for
   * @param foreignTable The table that the link field points to
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private getLinkValue(field: LinkFieldCore, foreignTable: TableDomain): string {
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
      this._fieldCteMap
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

  private getLookupValue(field: FieldCore, foreignTable: TableDomain): string {
    const qb = this.qb.client.queryBuilder();
    const selectVisitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      foreignTable,
      this._fieldCteMap
    );

    const targetLookupField = field.mustGetForeignLookupField(foreignTable);
    const targetFieldResult = targetLookupField.accept(selectVisitor);

    const expression =
      typeof targetFieldResult === 'string' ? targetFieldResult : targetFieldResult.toSQL().sql;
    if (!field.isMultipleCellValue) {
      return expression;
    }
    return this.getJsonAggregationFunction(expression);
  }

  private generateLinkFieldCte(field: LinkFieldCore): void {
    const foreignTable = this.tables.mustGetLinkForeignTable(field);
    const cteName = FieldCteVisitor.generateCTENameForField(this.table, field);
    const usesJunctionTable = getLinkUsesJunctionTable(field);
    const options = field.options as ILinkFieldOptions;
    const mainAlias = getTableAliasFromTable(this.table);
    const foreignAlias = getTableAliasFromTable(foreignTable);
    const { fkHostTableName, selfKeyName, foreignKeyName, relationship } = options;

    this.qb
      // eslint-disable-next-line sonarjs/cognitive-complexity
      .with(cteName, (cqb) => {
        const linkValue = this.getLinkValue(field, foreignTable);

        cqb.select(`${mainAlias}.${ID_FIELD_NAME} as main_record_id`);
        cqb.select(cqb.client.raw(`${linkValue} as link_value`));

        const lookupFields = field.getLookupFields(this.table);

        for (const lookupField of lookupFields) {
          const lookupValue = this.getLookupValue(lookupField, foreignTable);
          cqb.select(cqb.client.raw(`${lookupValue} as "lookup_${lookupField.id}"`));
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
            if (field.getHasOrderColumn()) {
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

    this._fieldCteMap.set(field.id, cteName);
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
