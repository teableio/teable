import {
  AbstractFieldVisitor,
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
} from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnType } from '../../visitors/PostgresTableSchemaFieldColumn';

import type { ISchemaRule } from '../core/ISchemaRule';
import type { TableIdentifier } from '../helpers/StatementBuilders';
import { ColumnRule } from './ColumnRule';
import { FieldMetaRule } from './FieldMetaRule';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { GeneratedColumnRule } from './GeneratedColumnRule';
import { IndexRule } from './IndexRule';
import { JunctionTableRule, type JunctionTableConfig } from './JunctionTableRule';
import { LinkValueColumnRule } from './LinkValueColumnRule';
import { OrderColumnRule } from './OrderColumnRule';
import { ReferenceRule } from './ReferenceRule';
import { UniqueIndexRule } from './UniqueIndexRule';

/**
 * Context needed for creating field schema rules.
 */
export interface FieldSchemaRulesContext {
  /** Current table schema */
  schema: string | null;
  /** Current table name */
  tableName: string;
  /** Current table ID */
  tableId: string;
}

/**
 * Helper to create a ColumnRule with description metadata.
 */
const createColumnRule = (field: Field): ColumnRule => {
  const fieldId = field.id().toString();
  const fieldName = field.name().toString();
  // Get human-readable data type for description
  const dataTypeResult = resolveColumnType(field);
  const dataType = dataTypeResult.isOk() ? String(dataTypeResult.value) : 'text';

  const fieldType = field.type().toString();
  const isComputed = field.computed().toBoolean();
  const notNullEnabled = checkFieldNotNullValidationEnabled(fieldType, { isComputed });
  const uniqueEnabled = checkFieldUniqueValidationEnabled(fieldType, { isComputed });

  return new ColumnRule(fieldId, fieldName, dataType, {
    notNull: notNullEnabled && field.notNull().toBoolean(),
    unique: uniqueEnabled && field.unique().toBoolean(),
  });
};

/**
 * Visitor that creates schema rules for each field type.
 */
export class FieldSchemaRulesVisitor extends AbstractFieldVisitor<ReadonlyArray<ISchemaRule>> {
  constructor(private readonly ctx: FieldSchemaRulesContext) {
    super();
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitLongTextField(field: LongTextField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitNumberField(field: NumberField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitRatingField(field: RatingField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitFormulaField(field: FormulaField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    const rules: ISchemaRule[] = [createColumnRule(field)];

    const dependencies = field.dependencies();
    if (dependencies.length > 0) {
      rules.push(
        ReferenceRule.multiple(
          fieldId,
          dependencies.map((d) => d.toString()),
          {
            fieldName,
            fieldType: 'formula',
          }
        )
      );
    }

    return ok(rules);
  }

  visitRollupField(field: RollupField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    const linkFieldId = field.linkFieldId().toString();
    const lookupFieldId = field.lookupFieldId().toString();

    return ok([
      createColumnRule(field),
      ReferenceRule.multiple(fieldId, [linkFieldId, lookupFieldId], {
        fieldName,
        fieldType: 'rollup',
      }),
    ]);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitCheckboxField(field: CheckboxField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitAttachmentField(field: AttachmentField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitDateField(field: DateField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([GeneratedColumnRule.forCreatedTime(field.id().toString(), field.name().toString())]);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    if (field.isTrackAll()) {
      return ok([GeneratedColumnRule.forLastModifiedTime(fieldId, fieldName)]);
    }
    // When not tracking all, it's a regular column
    return ok([createColumnRule(field)]);
  }

  visitUserField(field: UserField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitCreatedByField(field: CreatedByField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([GeneratedColumnRule.forCreatedBy(field.id().toString(), field.name().toString())]);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    if (field.isTrackAll()) {
      return ok([GeneratedColumnRule.forLastModifiedBy(fieldId, fieldName)]);
    }
    // When not tracking all, it's a regular column
    return ok([createColumnRule(field)]);
  }

  visitAutoNumberField(field: AutoNumberField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([GeneratedColumnRule.forAutoNumber(field.id().toString(), field.name().toString())]);
  }

  visitButtonField(field: ButtonField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([createColumnRule(field)]);
  }

  visitLinkField(field: LinkField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const ctx = this.ctx;
    return safeTry<ReadonlyArray<ISchemaRule>, DomainError>(function* () {
      const fieldId = field.id().toString();
      const fieldName = field.name().toString();
      const rules: ISchemaRule[] = [];

      const relationship = field.relationship().toString() as 'manyMany' | 'oneMany' | 'oneOne';
      const isOneWay = field.isOneWay();
      const relationshipType = isOneWay ? 'oneWay' : 'twoWay';

      // 1. Link value column (JSONB for storing display values)
      rules.push(new LinkValueColumnRule(fieldId, fieldName, relationshipType));

      // 2. Reference for the lookup field
      rules.push(
        ReferenceRule.single(fieldId, field.lookupFieldId().toString(), {
          fieldName,
          fieldType: 'link',
        })
      );

      const fkHostTableResult = field.fkHostTableName().split({ defaultSchema: ctx.schema });
      const fkHostTable = yield* fkHostTableResult;
      const foreignTableId = field.foreignTableId().toString();
      const baseId = field.baseId();
      const foreignTable: TableIdentifier = {
        schema: baseId ? baseId.toString() : ctx.schema,
        tableName: foreignTableId,
      };
      const currentTable: TableIdentifier = { schema: ctx.schema, tableName: ctx.tableName };

      if (relationship === 'manyMany') {
        // ManyMany: create junction table with indexes and FKs
        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();
        const orderColumnName = yield* field.orderColumnName();

        const junctionConfig: JunctionTableConfig = {
          junctionTable: fkHostTable,
          selfKeyName,
          foreignKeyName,
          orderColumnName,
          sourceTable: currentTable,
          foreignTable,
          withIndexes: true,
        };
        rules.push(
          new JunctionTableRule(fieldId, junctionConfig, {
            fieldName,
            relationshipType: 'manyMany',
            sourceTableName: ctx.tableName,
            foreignTableName: foreignTableId,
          })
        );
        rules.push(
          FieldMetaRule.forOrderColumn(fieldId, {
            dependsOnRuleId: `junction_table:${fieldId}`,
            fieldName,
          })
        );
      } else if (relationship === 'oneMany' && isOneWay) {
        // OneWay OneMany: create junction table without indexes
        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();
        const orderColumnName = yield* field.orderColumnName();

        const junctionConfig: JunctionTableConfig = {
          junctionTable: fkHostTable,
          selfKeyName,
          foreignKeyName,
          orderColumnName,
          sourceTable: currentTable,
          foreignTable,
          withIndexes: false,
        };
        rules.push(
          new JunctionTableRule(fieldId, junctionConfig, {
            fieldName,
            relationshipType: 'oneWay',
            sourceTableName: ctx.tableName,
            foreignTableName: foreignTableId,
          })
        );
      } else {
        // OneOne or regular OneMany: add FK columns to the host table
        const isCurrentTableHost =
          (fkHostTable.schema ?? null) === (ctx.schema ?? null) &&
          (fkHostTable.tableName === ctx.tableName || fkHostTable.tableName === ctx.tableId);

        if (isCurrentTableHost) {
          const keyName =
            relationship === 'oneMany'
              ? yield* field.selfKeyNameString()
              : yield* field.foreignKeyNameString();
          const orderColumnName = yield* field.orderColumnName();

          // FK column rule
          const fkColumnRule = new FkColumnRule(fieldId, keyName, {
            fieldName,
            referencedTableName: foreignTableId,
          });
          rules.push(fkColumnRule);

          // Index on FK column
          const indexRule =
            relationship === 'oneOne'
              ? new UniqueIndexRule(fieldId, keyName, {
                  required: true,
                  columnRuleId: fkColumnRule.id,
                  fieldName,
                  relationshipType: 'one-to-one',
                })
              : new IndexRule(fieldId, keyName, {
                  required: true,
                  columnRuleId: fkColumnRule.id,
                  fieldName,
                });
          rules.push(indexRule);

          // FK constraint
          rules.push(
            new ForeignKeyRule(fieldId, keyName, foreignTable, {
              targetColumn: '__id',
              onDelete: 'CASCADE',
              required: true,
              columnRuleId: fkColumnRule.id,
              fieldName,
              targetTableName: foreignTableId,
            })
          );

          // Order column
          rules.push(
            new OrderColumnRule(fieldId, orderColumnName, currentTable, {
              dependsOnRuleId: fkColumnRule.id,
              fieldName,
              targetTableName: ctx.tableName,
            })
          );

          // Field meta
          rules.push(
            FieldMetaRule.forOrderColumn(fieldId, {
              dependsOnRuleId: `order_column:${fieldId}`,
              fieldName,
            })
          );
        }
      }

      return ok(rules);
    });
  }

  override visitLookupField(field: LookupField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    // Lookup fields are computed fields that need their own column + references
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    const linkFieldId = field.linkFieldId().toString();
    const lookupFieldId = field.lookupFieldId().toString();

    return ok([
      createColumnRule(field),
      ReferenceRule.multiple(fieldId, [linkFieldId, lookupFieldId], {
        fieldName,
        fieldType: 'lookup',
      }),
    ]);
  }
}

/**
 * Creates schema rules for a field based on its type.
 */
export const createFieldSchemaRules = (
  field: Field,
  ctx: FieldSchemaRulesContext
): Result<ReadonlyArray<ISchemaRule>, DomainError> => {
  const visitor = new FieldSchemaRulesVisitor(ctx);
  return field.accept(visitor);
};
