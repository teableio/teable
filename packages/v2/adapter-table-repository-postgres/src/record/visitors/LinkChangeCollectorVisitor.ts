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
  RecordId,
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

import type { LinkChange, LinkChangeType, LinkRelationshipType } from '../computed/types';

/**
 * Context for collecting link changes.
 */
export interface LinkChangeCollectorContext {
  /** The record ID being updated */
  recordId: string;
  /** Existing linked record IDs (before the update) */
  existingLinkIds: ReadonlyArray<string>;
  /** New raw value being set */
  newRawValue: unknown;
}

/**
 * Result of visiting a field for link change collection.
 */
export type LinkChangeCollectorResult =
  | { hasChange: false }
  | { hasChange: true; linkChange: LinkChange };

/**
 * Visitor that collects link field changes and classifies them.
 *
 * This extracts the link change detection logic from the repository,
 * providing a cleaner separation of concerns.
 *
 * Example:
 * ```typescript
 * const visitor = LinkChangeCollectorVisitor.create({
 *   recordId: 'rec123',
 *   existingLinkIds: ['rec456', 'rec789'],
 *   newRawValue: [{ id: 'rec456' }, { id: 'rec999' }],
 * });
 * const result = field.accept(visitor);
 * if (result.isOk() && result.value.hasChange) {
 *   // Handle the link change
 * }
 * ```
 */
export class LinkChangeCollectorVisitor implements IFieldVisitor<LinkChangeCollectorResult> {
  private constructor(private readonly ctx: LinkChangeCollectorContext) {}

  static create(ctx: LinkChangeCollectorContext): LinkChangeCollectorVisitor {
    return new LinkChangeCollectorVisitor(ctx);
  }

  private noChange(): Result<LinkChangeCollectorResult, DomainError> {
    return ok({ hasChange: false });
  }

  // Non-link fields return no change
  visitSingleLineTextField(
    _field: SingleLineTextField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitLongTextField(_field: LongTextField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitNumberField(_field: NumberField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitRatingField(_field: RatingField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitFormulaField(_field: FormulaField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitRollupField(_field: RollupField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitLookupField(_field: LookupField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitSingleSelectField(
    _field: SingleSelectField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitMultipleSelectField(
    _field: MultipleSelectField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitCheckboxField(_field: CheckboxField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitDateField(_field: DateField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitAttachmentField(_field: AttachmentField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitUserField(_field: UserField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitCreatedTimeField(_field: CreatedTimeField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitCreatedByField(_field: CreatedByField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitLastModifiedByField(
    _field: LastModifiedByField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitAutoNumberField(_field: AutoNumberField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitButtonField(_field: ButtonField): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<LinkChangeCollectorResult, DomainError> {
    return this.noChange();
  }

  /**
   * Visit a link field and detect changes.
   */
  visitLinkField(field: LinkField): Result<LinkChangeCollectorResult, DomainError> {
    return safeTry<LinkChangeCollectorResult, DomainError>(
      function* (this: LinkChangeCollectorVisitor) {
        // Parse new link items
        const newLinkItems = yield* normalizeLinkItems(this.ctx.newRawValue);
        const newIds = newLinkItems.map((item) => item.id);

        // Classify the change
        const changeType = classifyLinkChange(field, this.ctx.existingLinkIds, newIds);

        if (changeType === 'none') {
          return ok({ hasChange: false } as LinkChangeCollectorResult);
        }

        // Determine relationship type
        const relationship = field.relationship().toString() as LinkRelationshipType;
        const isOneWay = field.isOneWay();

        // Get symmetric field info for twoWay links
        let symmetricFieldId: FieldId | undefined;
        let symmetricTableId: TableId | undefined;

        if (!isOneWay) {
          symmetricFieldId = field.symmetricFieldId();
          symmetricTableId = field.foreignTableId();
        }

        // Calculate added and removed record IDs
        const existingSet = new Set(this.ctx.existingLinkIds);
        const newSet = new Set(newIds);

        const addedIds: RecordId[] = [];
        const removedIds: RecordId[] = [];
        const currentIds: RecordId[] = [];

        for (const id of newIds) {
          const recordIdResult = RecordId.create(id);
          if (recordIdResult.isErr()) return err(recordIdResult.error);
          currentIds.push(recordIdResult.value);

          if (!existingSet.has(id)) {
            addedIds.push(recordIdResult.value);
          }
        }

        for (const id of this.ctx.existingLinkIds) {
          if (!newSet.has(id)) {
            const recordIdResult = RecordId.create(id);
            if (recordIdResult.isErr()) return err(recordIdResult.error);
            removedIds.push(recordIdResult.value);
          }
        }

        const linkChange: LinkChange = {
          fieldId: field.id(),
          changeType,
          relationship,
          isOneWay,
          symmetricFieldId,
          symmetricTableId,
          addedForeignRecordIds: addedIds,
          removedForeignRecordIds: removedIds,
          currentForeignRecordIds: currentIds,
        };

        return ok({ hasChange: true, linkChange });
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

/**
 * Classify how a link field's value changed.
 */
const classifyLinkChange = (
  field: LinkField,
  existingIds: ReadonlyArray<string>,
  newIds: ReadonlyArray<string>
): LinkChangeType => {
  const relationship = field.relationship().toString();
  const usesJunction =
    relationship === 'manyMany' || (relationship === 'oneMany' && field.isOneWay());
  // Check if the sets are different
  if (existingIds.length !== newIds.length) {
    // Size changed - definitely add or remove
    const existingSet = new Set(existingIds);
    const newSet = new Set(newIds);

    let hasAdded = false;
    let hasRemoved = false;

    for (const id of newIds) {
      if (!existingSet.has(id)) hasAdded = true;
    }
    for (const id of existingIds) {
      if (!newSet.has(id)) hasRemoved = true;
    }

    if (hasAdded && hasRemoved) return 'replace';
    if (hasAdded) return 'add';
    if (hasRemoved) return 'remove';
  }

  // Same size - check if same set
  const existingSet = new Set(existingIds);
  if (existingSet.size !== newIds.length) {
    // Different sets (size matches but content differs)
    return 'replace';
  }

  for (const id of newIds) {
    if (!existingSet.has(id)) {
      // Different content
      return 'replace';
    }
  }

  // Same set - check order (use junction order when no explicit order column)
  if (field.hasOrderColumn() || usesJunction) {
    const sameOrder = existingIds.every((id, index) => id === newIds[index]);
    if (!sameOrder) return 'reorder';
  }

  return 'none';
};

/**
 * Helper to collect all link changes from a record update.
 */
export type CollectedLinkChanges = {
  linkChanges: LinkChange[];
  /** Field IDs of links that had relation changes (not just reorder) */
  relationChangeFieldIds: FieldId[];
  /** All affected foreign record IDs grouped by table */
  affectedForeignRecords: Map<string, { tableId: TableId; recordIds: RecordId[] }>;
};

export const createEmptyCollectedLinkChanges = (): CollectedLinkChanges => ({
  linkChanges: [],
  relationChangeFieldIds: [],
  affectedForeignRecords: new Map(),
});

export const mergeCollectedLinkChange = (
  collected: CollectedLinkChanges,
  result: LinkChangeCollectorResult,
  foreignTableId: TableId
): void => {
  if (!result.hasChange) return;

  const { linkChange } = result;
  collected.linkChanges.push(linkChange);

  // Track relation changes (include reorder to refresh stored link values)
  collected.relationChangeFieldIds.push(linkChange.fieldId);

  // Collect affected foreign records for dirty propagation
  const tableKey = foreignTableId.toString();
  const existing = collected.affectedForeignRecords.get(tableKey) ?? {
    tableId: foreignTableId,
    recordIds: [],
  };

  // Add removed records (they need their symmetric link updated)
  for (const recordId of linkChange.removedForeignRecordIds) {
    existing.recordIds.push(recordId);
  }

  // Add newly linked records (they need their symmetric link and dependent lookups updated)
  for (const recordId of linkChange.addedForeignRecordIds) {
    existing.recordIds.push(recordId);
  }

  collected.affectedForeignRecords.set(tableKey, existing);
};
