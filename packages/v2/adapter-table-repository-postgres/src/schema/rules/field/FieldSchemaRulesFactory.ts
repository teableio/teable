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
import { ColumnUniqueConstraintRule } from './ColumnUniqueConstraintRule';
import { FieldMetaRule } from './FieldMetaRule';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { GeneratedColumnMetaRule } from './GeneratedColumnMetaRule';
import { GeneratedColumnRule } from './GeneratedColumnRule';
import { IndexRule } from './IndexRule';
import { JunctionTableExistsRule, type JunctionTableConfig } from './JunctionTableRule';
import { LinkSymmetricFieldRule } from './LinkSymmetricFieldRule';
import { LinkValueColumnRule } from './LinkValueColumnRule';
import { NotNullConstraintRule } from './NotNullConstraintRule';
import { OrderColumnRule } from './OrderColumnRule';
import { ReferenceRule } from './ReferenceRule';
import { SelectOptionsMetaRule } from './SelectOptionsMetaRule';
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

  private createStoredGeneratedColumnRules(
    field:
      | CreatedTimeField
      | LastModifiedTimeField
      | CreatedByField
      | LastModifiedByField
      | AutoNumberField,
    generatedRule: GeneratedColumnRule
  ): ReadonlyArray<ISchemaRule> {
    const columnRule = new ColumnExistsRule(field);
    const generatedMetaRule = new GeneratedColumnMetaRule(field, generatedRule, columnRule);
    const rules: ISchemaRule[] = [columnRule, generatedMetaRule];

    if (columnRule.shouldHaveNotNull()) {
      rules.push(new NotNullConstraintRule(field, generatedMetaRule));
    }

    if (columnRule.shouldHaveUnique()) {
      rules.push(new ColumnUniqueConstraintRule(field, generatedMetaRule));
    }

    return rules;
  }

  private createGeneratedColumnAwareRules(
    field:
      | CreatedTimeField
      | LastModifiedTimeField
      | CreatedByField
      | LastModifiedByField
      | AutoNumberField,
    generatedRule: GeneratedColumnRule
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return field
      .isPersistedAsGeneratedColumn()
      .map((shouldGenerate) =>
        shouldGenerate
          ? [generatedRule]
          : this.createStoredGeneratedColumnRules(field, generatedRule)
      );
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
    return ok([...ColumnExistsRule.createRulesFromField(field), new SelectOptionsMetaRule(field)]);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok([...ColumnExistsRule.createRulesFromField(field), new SelectOptionsMetaRule(field)]);
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
    return this.createGeneratedColumnAwareRules(field, GeneratedColumnRule.forCreatedTime(field));
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return this.createGeneratedColumnAwareRules(
      field,
      GeneratedColumnRule.forLastModifiedTime(field)
    );
  }

  visitUserField(field: UserField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return ok(ColumnExistsRule.createRulesFromField(field));
  }

  visitCreatedByField(field: CreatedByField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return this.createGeneratedColumnAwareRules(field, GeneratedColumnRule.forCreatedBy(field));
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return this.createGeneratedColumnAwareRules(
      field,
      GeneratedColumnRule.forLastModifiedBy(field)
    );
  }

  visitAutoNumberField(field: AutoNumberField): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    return this.createGeneratedColumnAwareRules(field, GeneratedColumnRule.forAutoNumber(field));
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
          foreignTableMetaId: foreignTableId,
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
        // OneOne or regular OneMany: add FK columns to the host table.
        const keyName =
          relationship === 'oneMany'
            ? yield* field.selfKeyNameString()
            : yield* field.foreignKeyNameString();
        const hasOrderColumn = field.hasOrderColumn();
        const referencedTable = relationship === 'oneMany' ? currentTable : foreignTable;
        const referencedTableName = relationship === 'oneMany' ? ctx.tableName : foreignTableId;

        const fkColumnRule = FkColumnRule.forField(
          field,
          keyName,
          referencedTableName,
          fkHostTable
        );
        rules.push(fkColumnRule);

        const indexRule =
          relationship === 'oneOne'
            ? UniqueIndexRule.forFkColumn(field, keyName, fkColumnRule, 'one-to-one', fkHostTable)
            : IndexRule.forFkColumn(field, keyName, fkColumnRule, fkHostTable);
        rules.push(indexRule);

        const onDelete = 'SET NULL';

        // FK constraint
        rules.push(
          ForeignKeyRule.forField(
            field,
            keyName,
            referencedTable,
            fkColumnRule,
            referencedTableName,
            onDelete,
            fkHostTable,
            relationship === 'oneMany' ? undefined : foreignTableId
          )
        );

        if (hasOrderColumn) {
          const orderColumnName = yield* field.orderColumnName();
          const orderRule = OrderColumnRule.forField(
            field,
            orderColumnName,
            fkHostTable,
            fkColumnRule
          );
          rules.push(orderRule);

          // Field meta (depends on order column)
          rules.push(FieldMetaRule.forOrderColumn(field, { dependsOnRuleId: orderRule.id }));
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
    const referenceRules: ISchemaRule[] = [
      ReferenceRule.single(field, lookupFieldId, { fieldType: 'lookup' }),
    ];

    if (linkFieldId !== lookupFieldId) {
      referenceRules.push(
        ReferenceRule.single(field, linkFieldId, { fieldType: 'lookup-link', required: false })
      );
    }

    return ok([...ColumnExistsRule.createRulesFromField(field), ...referenceRules]);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<ReadonlyArray<ISchemaRule>, DomainError> {
    // ConditionalRollup fields are computed fields that aggregate values from a foreign table
    // based on a condition. Unlike regular RollupField, they don't have a linkFieldId.
    // They reference the lookupFieldId and all field IDs used in the condition (filter/sort).
    const lookupFieldId = field.lookupFieldId().toString();
    const condition = field.config().condition();
    const conditionFieldIds = condition.referencedFieldIds().map((id) => id.toString());
    const sortFieldId = condition.sort()?.fieldId().toString();
    const allFromFieldIds = Array.from(
      new Set([lookupFieldId, ...conditionFieldIds, ...(sortFieldId ? [sortFieldId] : [])])
    );

    return ok([
      ...ColumnExistsRule.createRulesFromField(field),
      ReferenceRule.multiple(field, allFromFieldIds, {
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
    // They reference the lookupFieldId and all field IDs used in the condition (filter/sort).
    const lookupFieldId = field.lookupFieldId().toString();
    const condition = field.conditionalLookupOptions().condition();
    const conditionFieldIds = condition.referencedFieldIds().map((id) => id.toString());
    const sortFieldId = condition.sort()?.fieldId().toString();
    const allFromFieldIds = Array.from(
      new Set([lookupFieldId, ...conditionFieldIds, ...(sortFieldId ? [sortFieldId] : [])])
    );

    return ok([
      ...ColumnExistsRule.createRulesFromField(field),
      ReferenceRule.multiple(field, allFromFieldIds, {
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
