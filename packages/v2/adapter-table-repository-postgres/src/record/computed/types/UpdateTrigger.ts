import type { FieldId, RecordId, TableId } from '@teable/v2-core';

/**
 * Classification of how a link field's value changed.
 *
 * - `add`: Only new links were added (no existing links removed)
 * - `remove`: Only existing links were removed (no new links added)
 * - `replace`: Links were replaced (mixed add/remove, or full set operation)
 * - `reorder`: Only the order changed, same set of linked records
 * - `none`: No change detected
 */
export type LinkChangeType = 'add' | 'remove' | 'replace' | 'reorder' | 'none';

/**
 * Link relationship type.
 */
export type LinkRelationshipType = 'oneOne' | 'oneMany' | 'manyOne' | 'manyMany';

/**
 * Detailed information about a link field change.
 *
 * Used to determine propagation behavior and affected records.
 */
export type LinkChange = {
  /** The link field that changed */
  fieldId: FieldId;

  /** How the link changed */
  changeType: Exclude<LinkChangeType, 'none'>;

  /** The relationship type of the link */
  relationship: LinkRelationshipType;

  /** Whether this is a one-way link (no symmetric field) */
  isOneWay: boolean;

  /** For twoWay links: the symmetric field on the foreign table */
  symmetricFieldId?: FieldId;

  /** For twoWay links: the foreign table ID */
  symmetricTableId?: TableId;

  /** Record IDs that gained a link (in the foreign table) */
  addedForeignRecordIds: ReadonlyArray<RecordId>;

  /** Record IDs that lost a link (in the foreign table) */
  removedForeignRecordIds: ReadonlyArray<RecordId>;

  /** All currently linked record IDs (after the change) */
  currentForeignRecordIds: ReadonlyArray<RecordId>;
};

/**
 * Update trigger information collected from a record update operation.
 *
 * This separates "what changed" from "how to propagate", allowing the
 * propagation logic to be unified and simpler.
 */
export type UpdateTrigger = {
  /** The table being updated */
  tableId: TableId;

  /** The record being updated */
  recordId: RecordId;

  /** Non-link fields that had value changes */
  valueChangedFieldIds: ReadonlyArray<FieldId>;

  /** Link fields that had relation changes */
  linkChanges: ReadonlyArray<LinkChange>;
};

/**
 * Batch update trigger for multiple records.
 */
export type BatchUpdateTrigger = {
  /** The table being updated */
  tableId: TableId;

  /** Individual record triggers */
  recordTriggers: ReadonlyArray<UpdateTrigger>;

  /** Aggregated: all value-changed field IDs across records */
  allValueChangedFieldIds: ReadonlyArray<FieldId>;

  /** Aggregated: all link changes across records */
  allLinkChanges: ReadonlyArray<LinkChange>;
};

/**
 * Build a BatchUpdateTrigger from individual UpdateTriggers.
 */
export const buildBatchUpdateTrigger = (
  tableId: TableId,
  triggers: ReadonlyArray<UpdateTrigger>
): BatchUpdateTrigger => {
  const valueFieldIdSet = new Map<string, FieldId>();
  const linkChangeMap = new Map<string, LinkChange>();

  for (const trigger of triggers) {
    for (const fieldId of trigger.valueChangedFieldIds) {
      valueFieldIdSet.set(fieldId.toString(), fieldId);
    }
    for (const linkChange of trigger.linkChanges) {
      const key = linkChange.fieldId.toString();
      const existing = linkChangeMap.get(key);
      if (existing) {
        // Merge: combine affected record IDs
        linkChangeMap.set(key, mergeLinkChanges(existing, linkChange));
      } else {
        linkChangeMap.set(key, linkChange);
      }
    }
  }

  return {
    tableId,
    recordTriggers: triggers,
    allValueChangedFieldIds: [...valueFieldIdSet.values()],
    allLinkChanges: [...linkChangeMap.values()],
  };
};

/**
 * Merge two LinkChange objects for the same field.
 */
const mergeLinkChanges = (a: LinkChange, b: LinkChange): LinkChange => {
  const addedSet = new Map<string, RecordId>();
  const removedSet = new Map<string, RecordId>();
  const currentSet = new Map<string, RecordId>();

  for (const id of a.addedForeignRecordIds) addedSet.set(id.toString(), id);
  for (const id of b.addedForeignRecordIds) addedSet.set(id.toString(), id);

  for (const id of a.removedForeignRecordIds) removedSet.set(id.toString(), id);
  for (const id of b.removedForeignRecordIds) removedSet.set(id.toString(), id);

  for (const id of a.currentForeignRecordIds) currentSet.set(id.toString(), id);
  for (const id of b.currentForeignRecordIds) currentSet.set(id.toString(), id);

  // Determine merged change type
  let changeType: Exclude<LinkChangeType, 'none'> = 'replace';
  if (addedSet.size > 0 && removedSet.size === 0) {
    changeType = 'add';
  } else if (removedSet.size > 0 && addedSet.size === 0) {
    changeType = 'remove';
  }

  return {
    ...a,
    changeType,
    addedForeignRecordIds: [...addedSet.values()],
    removedForeignRecordIds: [...removedSet.values()],
    currentForeignRecordIds: [...currentSet.values()],
  };
};
