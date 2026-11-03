import {
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  domainError,
  type DomainError,
  type FieldId,
  type FormulaField,
  type IFieldVisitor,
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
  type TableId,
  type UserField,
  ok,
  err,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { safeTry } from 'neverthrow';

/**
 * Describes the complete desired links for one exclusive source field.
 * Requested records must be unowned, already owned by this source, or explicitly
 * released by another source in the same request. Empty intents represent releases.
 */
export interface LinkExclusivityConstraint {
  /** The link field that has the constraint */
  fieldId: FieldId;
  /** The foreign table being linked to */
  foreignTableId: TableId;
  /** The FK host table name (where the FK column lives) */
  fkHostTableName: string;
  /** The column name for the self key (points to source record) */
  selfKeyName: string;
  /** The column name for the foreign key (points to foreign record) */
  foreignKeyName: string;
  /** Optional ordering column cleared with the physical owner FK. */
  releaseOrderColumnName?: string;
  /** All requested foreign records, including retained links and reordering */
  desiredForeignRecordIds: ReadonlyArray<string>;
  /** The source record ID making this update */
  sourceRecordId: string;
  /** Whether this is a one-way link */
  isOneWay: boolean;
  /** Whether this uses a junction table (oneMany isOneWay) vs main/foreign table storage (oneOne, oneMany two-way) */
  usesJunctionTable: boolean;
}

/**
 * Context for collecting exclusivity constraints.
 */
export interface LinkExclusivityCollectorContext {
  /** The record ID being updated */
  recordId: string;
  /** New raw value being set */
  newRawValue: unknown;
}

/**
 * Result of visiting a field for exclusivity constraint collection.
 */
export type LinkExclusivityCollectorResult =
  | { hasConstraint: false }
  | { hasConstraint: true; constraint: LinkExclusivityConstraint };

/**
 * Visitor that collects link field exclusivity constraints.
 *
 * For link fields with oneOne or oneMany relationships, this visitor preserves
 * the complete desired ownership intent, including empty values, so request-wide
 * validation can distinguish explicit releases from owners left unchanged.
 *
 * Non-link fields and link fields without exclusivity requirements
 * return { hasConstraint: false }.
 *
 * Example:
 * ```typescript
 * const visitor = LinkExclusivityConstraintCollector.create({
 *   recordId: 'rec123',
 *   newRawValue: [{ id: 'rec456' }, { id: 'rec789' }],
 * });
 * const result = field.accept(visitor);
 * if (result.isOk() && result.value.hasConstraint) {
 *   // Validate all requested targets and preserve this source's release intent.
 * }
 * ```
 */
export class LinkExclusivityConstraintCollector implements IFieldVisitor<LinkExclusivityCollectorResult> {
  private constructor(private readonly ctx: LinkExclusivityCollectorContext) {}

  static create(ctx: LinkExclusivityCollectorContext): LinkExclusivityConstraintCollector {
    return new LinkExclusivityConstraintCollector(ctx);
  }

  private noConstraint(): Result<LinkExclusivityCollectorResult, DomainError> {
    return ok({ hasConstraint: false });
  }

  // Non-link fields return no constraint
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitLongTextField(_field: LongTextField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitNumberField(_field: NumberField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitRatingField(_field: RatingField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitFormulaField(_field: FormulaField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitRollupField(_field: RollupField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitLookupField(_field: LookupField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitCheckboxField(_field: CheckboxField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitDateField(_field: DateField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitAttachmentField(
    _field: AttachmentField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitUserField(_field: UserField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitCreatedTimeField(
    _field: CreatedTimeField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitCreatedByField(_field: CreatedByField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitLastModifiedByField(
    _field: LastModifiedByField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitAutoNumberField(
    _field: AutoNumberField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitButtonField(_field: ButtonField): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<LinkExclusivityCollectorResult, DomainError> {
    return this.noConstraint();
  }

  /**
   * Visit a link field and collect exclusivity constraint if applicable.
   */
  visitLinkField(field: LinkField): Result<LinkExclusivityCollectorResult, DomainError> {
    return safeTry<LinkExclusivityCollectorResult, DomainError>(
      function* (this: LinkExclusivityConstraintCollector) {
        // Only check fields that require exclusivity
        if (!field.requiresExclusiveForeignRecord()) {
          return ok({ hasConstraint: false } as LinkExclusivityCollectorResult);
        }

        // Parse new link items
        const newLinkItems = yield* normalizeLinkItems(this.ctx.newRawValue);
        const newIds = newLinkItems.map((item) => item.id);

        // Keep empty intents: the SQL still clears this source's previous links,
        // and another source in the same request may claim a released target.

        // Get FK table configuration
        const fkHostTableSplit = yield* field.fkHostTableName().split({ defaultSchema: 'public' });
        const fkHostTableName = fkHostTableSplit.schema
          ? `${fkHostTableSplit.schema}.${fkHostTableSplit.tableName}`
          : fkHostTableSplit.tableName;

        const selfKeyName = yield* field.selfKeyNameString();
        const foreignKeyName = yield* field.foreignKeyNameString();

        // Determine if this uses junction table
        // oneMany with isOneWay uses junction table, oneOne doesn't
        const relationship = field.relationship().toString();
        const usesJunctionTable = relationship === 'oneMany' && field.isOneWay();
        let releaseOrderColumnName: string | undefined;
        if (foreignKeyName === '__id' && field.hasOrderColumn()) {
          releaseOrderColumnName =
            relationship === 'oneMany' ? yield* field.orderColumnName() : `${selfKeyName}_order`;
        }

        const constraint: LinkExclusivityConstraint = {
          fieldId: field.id(),
          foreignTableId: field.foreignTableId(),
          fkHostTableName,
          selfKeyName,
          foreignKeyName,
          ...(releaseOrderColumnName ? { releaseOrderColumnName } : {}),
          desiredForeignRecordIds: newIds,
          sourceRecordId: this.ctx.recordId,
          isOneWay: field.isOneWay(),
          usesJunctionTable,
        };

        return ok({ hasConstraint: true, constraint });
      }.bind(this)
    );
  }
}

/**
 * Parse and normalize raw link value into link items.
 */
type LinkItem = { id: string };

const normalizeLinkItems = (rawValue: unknown): Result<ReadonlyArray<LinkItem>, DomainError> => {
  if (rawValue === null || rawValue === undefined) return ok([]);
  const items = Array.isArray(rawValue) ? rawValue : [rawValue];
  const normalized: LinkItem[] = [];

  for (const item of items) {
    if (item && typeof item === 'object' && 'id' in item) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string') {
        normalized.push({ id });
        continue;
      }
    }
    return err(domainError.validation({ message: 'Invalid link item format' }));
  }

  return ok(normalized);
};
