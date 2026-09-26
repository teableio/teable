import type { IRecord } from '@teable/core';
import { isEmpty, isEqual } from 'lodash';
import type { Doc } from 'sharedb/lib/client';

export type ProjectedFieldMergeMode = 'refresh' | 'fill';

export const refreshDocsMatchFetch = (
  currentDocIds: readonly string[],
  fetchedRecords: readonly Pick<IRecord, 'id'>[]
): boolean =>
  currentDocIds.length === fetchedRecords.length &&
  currentDocIds.every((id, index) => id === fetchedRecords[index]?.id);

export const docsForProjectedFill = (
  liveDocs: Doc<IRecord>[],
  fetchedRecords: readonly Pick<IRecord, 'id'>[]
): Doc<IRecord>[] | undefined => {
  if (!liveDocs.length) {
    return undefined;
  }
  const liveIds = new Set(liveDocs.map((doc) => doc.id));
  if (!fetchedRecords.some((record) => liveIds.has(record.id))) {
    return undefined;
  }
  return liveDocs;
};

const hasOwn = (fields: Record<string, unknown>, fieldId: string) => Object.hasOwn(fields, fieldId);

const PERMISSION_ACTIONS = ['read', 'update'] as const;

/**
 * Merge the field-permission map a projected HTTP response carries for the
 * same projection.
 *
 * getRecords returns `permissions.read/update` keyed by the requested field
 * ids only, and Record.isHidden/isLocked treat a field missing from a
 * non-empty map as denied. Cells merged without their permission entries leave
 * every late-loaded column invisible and locked.
 *
 * A doc with no permission map — or an empty one, which Record.isHidden /
 * Record.isLocked also read as unrestricted — stays unmapped: a partial map
 * would deny every field the response did not cover.
 */
const mergeProjectedFieldPermissions = (
  doc: Doc<IRecord>,
  fetchedPermissions: IRecord['permissions'],
  fieldIds: readonly string[]
): boolean => {
  const docPermissions = doc.data.permissions;
  if (!docPermissions || !fetchedPermissions || isEmpty(docPermissions)) {
    return false;
  }

  let changed = false;

  PERMISSION_ACTIONS.forEach((action) => {
    const nextPermissions = fetchedPermissions[action];
    if (!nextPermissions) {
      return;
    }
    fieldIds.forEach((fieldId) => {
      const nextValue = nextPermissions[fieldId];
      if (typeof nextValue !== 'boolean' || docPermissions[action]?.[fieldId] === nextValue) {
        return;
      }
      (docPermissions[action] ??= {})[fieldId] = nextValue;
      changed = true;
    });
  });

  return changed;
};

/**
 * Merge HTTP-projected cells into live ShareDB docs.
 *
 * getRecords omits empty cells. Missing keys are never treated as clears.
 * Field permissions ride along: the same response is the only source for the
 * permission entries of the fields it projects.
 *
 * - refresh: schema-refresh path. Overwrite when the fetched value is present
 *   and different (keeps optimistic locals when the fetch omits the key).
 * - fill: viewport column fill. Never clobber a key that already exists on the
 *   doc — live ops and local edits win over a later HTTP fill.
 */
export const mergeProjectedFieldsIntoDocs = <T>(
  docs: Doc<IRecord>[],
  fetchedById: ReadonlyMap<string, IRecord>,
  fieldIds: readonly string[],
  mode: ProjectedFieldMergeMode
): Doc<T>[] => {
  const changedDocs: Doc<T>[] = [];

  docs.forEach((doc) => {
    const fetchedRecord = fetchedById.get(doc.id);
    if (!fetchedRecord || !doc.data) {
      return;
    }

    let changed = false;
    const docFields = doc.data.fields ?? {};
    const nextFields = fetchedRecord.fields ?? {};

    fieldIds.forEach((fieldId) => {
      const nextValue = nextFields[fieldId];
      if (nextValue === undefined) {
        return;
      }
      if (mode === 'fill' && hasOwn(docFields, fieldId)) {
        return;
      }
      const currentValue = docFields[fieldId];
      if (isEqual(currentValue, nextValue)) {
        return;
      }
      doc.data.fields ??= {};
      doc.data.fields[fieldId] = nextValue;
      changed = true;
    });

    const permissionsChanged = mergeProjectedFieldPermissions(
      doc,
      fetchedRecord.permissions,
      fieldIds
    );

    if (changed || permissionsChanged) {
      changedDocs.push(doc as unknown as Doc<T>);
    }
  });

  return changedDocs;
};
