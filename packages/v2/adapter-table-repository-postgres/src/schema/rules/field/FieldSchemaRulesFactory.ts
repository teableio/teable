import {
  AbstractFieldVisitor,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
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

import type { ISchemaRule } from '../core/ISchemaRule';
import type { TableIdentifier } from '../helpers/StatementBuilders';
import { ColumnExistsRule } from './ColumnExistsRule';
import { FieldMetaRule } from './FieldMetaRule';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { GeneratedColumnRule } from './GeneratedColumnRule';
import { IndexRule } from './IndexRule';
import { JunctionTableExistsRule, type JunctionTableConfig } from './JunctionTableRule';
import { LinkSymmetricFieldRule } from './LinkSymmetricFieldRule';
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
 * Visitor that creates schema rules for each field type.
 */
export class FieldSchemaRulesVisitor extends AbstractFieldVisitor<ReadonlyArray<ISchemaRule>> {
  constructor(private readonly ctx: FieldSchemaRulesContext) {
    super();
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitLongTextField(field: LongTextField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitNumberField(field: NumberField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitRatingField(field: RatingField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitFormulaField(field: FormulaField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const rules: ISchemaRule[] = [...ColumnExistsRule.createRulesFromField(field)];

    const dependencies = field.dependencies();
    if (dependencies.length > 0) {
      rules.push(
        ReferenceRule.multiple(
          field,
          dependencies.map((d) => d.toString()),
          { fieldType: 'formula' }
        )
      );
    }

    return ok(rules);
  }

  visitRollupField(field: RollupField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const linkFieldId = field.linkFieldId().toString();
    const lookupFieldId = field.lookupFieldId().toString();

    return ok([
      ...ColumnExistsRule.createRulesFromField(field),
      ReferenceRule.multiple(field, [linkFieldId, lookupFieldId], { fieldType: 'rollup' }),
    ]);
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitCheckboxField(field: CheckboxField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitAttachmentField(field: AttachmentField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitDateField(field: DateField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .map((shouldGenerate) =>
        shouldGenerate
          ? [GeneratedColumnRule.forCreatedTime(field)]
          : ColumnExistsRule.createRulesFromField(field)
      );
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .map((shouldGenerate) =>
        shouldGenerate
          ? [GeneratedColumnRule.forLastModifiedTime(field)]
          : ColumnExistsRule.createRulesFromField(field)
      );
  }

  visitUserField(field: UserField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitCreatedByField(field: CreatedByField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .map((shouldGenerate) =>
        shouldGenerate
          ? [GeneratedColumnRule.forCreatedBy(field)]
          : ColumnExistsRule.createRulesFromField(field)
      );
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .map((shouldGenerate) =>
        shouldGenerate
          ? [GeneratedColumnRule.forLastModifiedBy(field)]
          : ColumnExistsRule.createRulesFromField(field)
      );
  }

  visitAutoNumberField(field: AutoNumberField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .map((shouldGenerate) =>
        shouldGenerate
          ? [GeneratedColumnRule.forAutoNumber(field)]
          : ColumnExistsRule.createRulesFromField(field)
      );
  }

  visitButtonField(field: ButtonField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitLinkField(field: LinkField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    const ctx = this.ctx;
    return safeTry<ReadonlyArray<ISchemaRule>, DomainError>(function* () {
      const rules: ISchemaRule[] = [];

      const relationship = field.relationship().toString() as 'manyMany' | 'oneMany' | 'oneOne';
      const isOneWay = field.isOneWay();
      const relationshipType = isOneWay ? 'oneWay' : 'twoWay';

      // 1. Link value column (JSONB for storing display values)
      rules.push(LinkValueColumnRule.forField(field, relationshipType));

      // 2. Reference for the lookup field
      rules.push(
        ReferenceRule.single(field, field.lookupFieldId().toString(), { fieldType: 'link' })
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

      if (relationship === 'manyMany' || (relationship === 'oneMany' && isOneWay)) {
        // ManyMany or OneWay OneMany: create junction table
        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();
        const hasOrderColumn = field.hasOrderColumn();
        const orderColumnName = hasOrderColumn ? yield* field.orderColumnName() : undefined;

        const junctionConfig: JunctionTableConfig = {
          junctionTable: fkHostTable,
          selfKeyName,
          foreignKeyName,
          orderColumnName,
          sourceTable: currentTable,
          foreignTable,
          withIndexes: relationship === 'manyMany', // Only ManyMany gets indexes
        };

        // Use the static factory method to create all junction table rules
        const junctionRules = JunctionTableExistsRule.createRulesFromField(field, junctionConfig);
        rules.push(...junctionRules);

        if (hasOrderColumn) {
          // Field metadata (depends on junction table)
          const junctionTableRuleId = `junction_table:${field.id().toString()}`;
          rules.push(FieldMetaRule.forOrderColumn(field, { dependsOnRuleId: junctionTableRuleId }));
        }
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
          const hasOrderColumn = field.hasOrderColumn();

          // FK column rule
          const fkColumnRule = FkColumnRule.forField(field, keyName, foreignTableId);
          rules.push(fkColumnRule);

          // Index on FK column
          const indexRule =
            relationship === 'oneOne'
              ? UniqueIndexRule.forFkColumn(field, keyName, fkColumnRule, 'one-to-one')
              : IndexRule.forFkColumn(field, keyName, fkColumnRule);
          rules.push(indexRule);

          const onDelete = 'SET NULL';

          // FK constraint
          rules.push(
            ForeignKeyRule.forField(
              field,
              keyName,
              foreignTable,
              fkColumnRule,
              foreignTableId,
              onDelete
            )
          );

          if (hasOrderColumn) {
            const orderColumnName = yield* field.orderColumnName();

            // Order column
            const orderRule = OrderColumnRule.forField(
              field,
              orderColumnName,
              currentTable,
              fkColumnRule
            );
            rules.push(orderRule);

            // Field meta (depends on order column)
            rules.push(FieldMetaRule.forOrderColumn(field, { dependsOnRuleId: orderRule.id }));
          }
        }
      }

      // Symmetric field validation for two-way links
      const symmetricRule = LinkSymmetricFieldRule.forField(field);
      if (symmetricRule) {
        rules.push(symmetricRule);
      }

      return ok(rules);
    });
  }

  override visitLookupField(field: LookupField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    // Lookup fields are computed fields that need their own column + references
    const linkFieldId = field.linkFieldId().toString();
    const lookupFieldId = field.lookupFieldId().toString();

    return ok([
      ...ColumnExistsRule.createRulesFromField(field),
      ReferenceRule.single(field, lookupFieldId, { fieldType: 'lookup' }),
      ReferenceRule.single(field, linkFieldId, { fieldType: 'lookup-link', required: false }),
    ]);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    // ConditionalRollup fields are computed fields that aggregate values from a foreign table
    // based on a condition. Unlike regular RollupField, they don't have a linkFieldId.
    // They only reference the lookupFieldId in the foreign table.
    const lookupFieldId = field.lookupFieldId().toString();

    return ok([
      ...ColumnExistsRule.createRulesFromField(field),
      // Reference only the lookup field - conditional rollup doesn't depend on a link field
      ReferenceRule.single(field, lookupFieldId, {
        fieldType: 'conditionalRollup',
        required: false,
      }),
    ]);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    // ConditionalLookup fields are computed fields that lookup values from a foreign table
    // based on a condition. Unlike regular LookupField, they don't have a linkFieldId.
    // They only reference the lookupFieldId in the foreign table.
    const lookupFieldId = field.lookupFieldId().toString();

    return ok([
      ...ColumnExistsRule.createRulesFromField(field),
      // Reference only the lookup field - conditional lookup doesn't depend on a link field
      ReferenceRule.single(field, lookupFieldId, {
        fieldType: 'conditionalLookup',
        required: false,
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
