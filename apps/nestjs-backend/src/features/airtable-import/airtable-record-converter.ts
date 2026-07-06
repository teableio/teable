import type { IAirtableCellConverter } from './airtable-schema-mapper';
import type { IAirtableCollaborator } from './airtable.types';

/**
 * Computed Airtable cells can carry error markers instead of values, e.g.
 * `{"error": "#ERROR!"}` or `{"specialValue": "NaN"}`.
 */
const isErrorValue = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  ('error' in value || 'specialValue' in value);

const sanitizeString = (value: string) => value.replace(/\0/g, '');

const toDisplayString = (value: unknown): string | undefined => {
  if (value == null || isErrorValue(value)) return undefined;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(toDisplayString).filter((part): part is string => part != null);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Attachment-like, collaborator-like and button-like objects.
    const label = record.filename ?? record.name ?? record.label ?? record.text ?? record.email;
    if (typeof label === 'string') return sanitizeString(label);
    return undefined;
  }
  return undefined;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const collaboratorToText = (value: IAirtableCollaborator): string | undefined => {
  if (value.name && value.email) return `${value.name} (${value.email})`;
  return value.name ?? value.email ?? undefined;
};

/**
 * Converts a raw Airtable cell value (`cellFormat=json`) to a Teable cell
 * value for the given converter kind. Returns `undefined` when the cell
 * should stay empty. `user` and `attachment` cells need external context
 * (collaborator resolution, file re-upload) and are handled by the importer.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function convertAirtableCellValue(converter: IAirtableCellConverter, raw: unknown): unknown {
  if (raw == null) return undefined;
  switch (converter) {
    case 'string':
      return typeof raw === 'string' ? sanitizeString(raw) || undefined : toDisplayString(raw);
    case 'number':
      return isErrorValue(raw) ? undefined : toNumber(raw);
    case 'boolean':
      return raw === true ? true : undefined;
    case 'dateTime':
      return typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
    case 'stringArray': {
      const values = Array.isArray(raw) ? raw : [raw];
      const names = values.filter((item): item is string => typeof item === 'string');
      return names.length > 0 ? names : undefined;
    }
    case 'barcode':
      return typeof (raw as { text?: unknown }).text === 'string'
        ? sanitizeString((raw as { text: string }).text)
        : undefined;
    case 'button': {
      const { label, url } = raw as { label?: unknown; url?: unknown };
      const labelText = typeof label === 'string' ? label : undefined;
      const urlText = typeof url === 'string' ? url : undefined;
      if (labelText && urlText) return `${labelText} (${urlText})`;
      return labelText ?? urlText ?? undefined;
    }
    case 'aiText': {
      const value = (raw as { value?: unknown }).value;
      return typeof value === 'string' ? sanitizeString(value) || undefined : undefined;
    }
    case 'collaboratorText': {
      const collaborators = (Array.isArray(raw) ? raw : [raw]) as IAirtableCollaborator[];
      const parts = collaborators
        .filter((item) => typeof item === 'object' && item !== null)
        .map(collaboratorToText)
        .filter((part): part is string => part != null);
      return parts.length > 0 ? parts.join('; ') : undefined;
    }
    case 'snapshotText':
      return toDisplayString(raw);
    case 'snapshotNumber': {
      if (isErrorValue(raw)) return undefined;
      if (Array.isArray(raw)) return toNumber(raw[0]);
      return toNumber(raw);
    }
    case 'snapshotDate': {
      const value = Array.isArray(raw) ? raw[0] : raw;
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
    }
    case 'snapshotCheckbox': {
      const value = Array.isArray(raw) ? raw[0] : raw;
      return value === true ? true : undefined;
    }
    // Resolved asynchronously by the importer.
    case 'user':
    case 'attachment':
      return undefined;
    default:
      return undefined;
  }
}

export interface IResolvedSpaceUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Converts Airtable collaborator cells to Teable user cell values by matching
 * collaborator emails against the target space's collaborators. Returns the
 * number of collaborators that could not be matched (and were dropped).
 */
export const convertCollaboratorCellValue = (
  raw: unknown,
  usersByEmail: Map<string, IResolvedSpaceUser>,
  isMultiple: boolean
): { value: unknown; droppedCount: number } => {
  const collaborators = (Array.isArray(raw) ? raw : [raw]).filter(
    (item): item is IAirtableCollaborator => typeof item === 'object' && item !== null
  );
  const resolved = [];
  let droppedCount = 0;
  for (const collaborator of collaborators) {
    const user = collaborator.email
      ? usersByEmail.get(collaborator.email.toLowerCase())
      : undefined;
    if (user) {
      resolved.push({ id: user.id, title: user.name, email: user.email });
    } else {
      droppedCount++;
    }
  }
  if (resolved.length === 0) {
    return { value: undefined, droppedCount };
  }
  return { value: isMultiple ? resolved : resolved[0], droppedCount };
};

/** Extracts linked record ids from a multipleRecordLinks cell. */
export const extractLinkedRecordIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item;
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'string'
      ) {
        return (item as { id: string }).id;
      }
      return undefined;
    })
    .filter((id): id is string => id != null);
};
