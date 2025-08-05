import { Logger } from '@nestjs/common';
import type {
  ILinkFieldOptions,
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
} from '@teable/core';
import { DriverClient, Relationship } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../db-provider/db.provider.interface';
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
  constructor(
    private readonly dbProvider: IDbProvider,
    private readonly context: IFieldCteContext
  ) {}

  /**
   * Generate CTE name for a field
   */
  private getCteNameForField(fieldId: string): string {
    return `cte_${fieldId.replace(/[^a-z0-9]/gi, '_')}`;
  }

  /**
   * Generate JSON aggregation function based on database type
   */
  private getJsonAggregationFunction(tableAlias: string, lookupFieldName: string): string {
    const driver = this.dbProvider.driver;

    // Use table alias for cleaner SQL
    const recordIdRef = `${tableAlias}."__id"`;
    const titleRef = `${tableAlias}."${lookupFieldName}"`;

    if (driver === DriverClient.Pg) {
      return `json_agg(json_build_object('id', ${recordIdRef}, 'title', ${titleRef}))`;
    } else if (driver === DriverClient.Sqlite) {
      return `json_group_array(json_object('id', ${recordIdRef}, 'title', ${titleRef}))`;
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  /**
   * Generate single JSON object function based on database type
   */
  private getSingleJsonObjectFunction(tableAlias: string, lookupFieldName: string): string {
    const driver = this.dbProvider.driver;

    // Use table alias for cleaner SQL
    const recordIdRef = `${tableAlias}."__id"`;
    const titleRef = `${tableAlias}."${lookupFieldName}"`;

    if (driver === DriverClient.Pg) {
      return `json_build_object('id', ${recordIdRef}, 'title', ${titleRef})`;
    } else if (driver === DriverClient.Sqlite) {
      return `json_object('id', ${recordIdRef}, 'title', ${titleRef})`;
    }

    throw new Error(`Unsupported database driver: ${driver}`);
  }

  /**
   * Generate CTE for Link field based on relationship type
   */
  private generateLinkFieldCte(field: LinkFieldCore): ICteResult {
    const options = field.options as ILinkFieldOptions;
    const {
      relationship,
      fkHostTableName,
      selfKeyName,
      foreignKeyName,
      foreignTableId,
      lookupFieldId,
    } = options;

    const cteName = this.getCteNameForField(field.id);
    const mainTableName = this.context.mainTableName;
    const foreignTableName = this.context.tableNameMap.get(foreignTableId);
    const lookupField = this.context.fieldMap.get(lookupFieldId);

    if (!foreignTableName || !lookupField) {
      return { hasChanges: false };
    }

    // Create CTE callback function
    const cteCallback = (qb: Knex.QueryBuilder) => {
      // Use aliases to avoid table name conflicts and make SQL more readable
      const mainAlias = 'm';
      const junctionAlias = 'j';
      const foreignAlias = 'f';

      if (
        relationship === Relationship.ManyMany ||
        (relationship === Relationship.OneMany && field.isMultipleCellValue)
      ) {
        // Multiple values - use JSON aggregation
        const jsonAggFunction = this.getJsonAggregationFunction(
          foreignAlias,
          lookupField.dbFieldName
        );

        qb.select([
          `${mainAlias}.__id as main_record_id`,
          qb.client.raw(`${jsonAggFunction} as link_value`),
        ])
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
      } else {
        // Single value - use single JSON object
        const jsonObjectFunction = this.getSingleJsonObjectFunction(
          foreignAlias,
          lookupField.dbFieldName
        );

        qb.select([
          `${mainAlias}.__id as main_record_id`,
          qb.client.raw(`${jsonObjectFunction} as link_value`),
        ])
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
      }
    };

    return { cteName, hasChanges: true, cteCallback };
  }

  // Field visitor methods - most fields don't need CTEs
  visitNumberField(_field: NumberFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitSingleLineTextField(_field: SingleLineTextFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitLongTextField(_field: LongTextFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitAttachmentField(_field: AttachmentFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitCheckboxField(_field: CheckboxFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitDateField(_field: DateFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitRatingField(_field: RatingFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitAutoNumberField(_field: AutoNumberFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitLinkField(field: LinkFieldCore): ICteResult {
    // Skip lookup Link fields - they use pre-computed values
    if (field.isLookup) {
      return { hasChanges: false };
    }

    return this.generateLinkFieldCte(field);
  }

  visitRollupField(_field: RollupFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitSingleSelectField(_field: SingleSelectFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitMultipleSelectField(_field: MultipleSelectFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitFormulaField(_field: FormulaFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitCreatedTimeField(_field: CreatedTimeFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitUserField(_field: UserFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitCreatedByField(_field: CreatedByFieldCore): ICteResult {
    return { hasChanges: false };
  }

  visitLastModifiedByField(_field: LastModifiedByFieldCore): ICteResult {
    return { hasChanges: false };
  }
}
