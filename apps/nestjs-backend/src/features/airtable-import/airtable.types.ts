/**
 * Typings for the subset of the official Airtable Web API used by the importer.
 * https://airtable.com/developers/web/api
 */

export interface IAirtableBaseItem {
  id: string;
  name: string;
  permissionLevel: 'none' | 'read' | 'comment' | 'edit' | 'create';
}

export interface IAirtableListBasesResponse {
  bases: IAirtableBaseItem[];
  offset?: string;
}

export interface IAirtableSelectChoice {
  id: string;
  name: string;
  color?: string;
}

export interface IAirtableFieldResult {
  type: string;
  options?: Record<string, unknown>;
}

/**
 * Per-type options. The official API documents one shape per field type; we
 * keep a single permissive interface because the mapper only reads a few keys
 * per type and unknown field types must not break the import.
 */
export interface IAirtableFieldOptions {
  // number / percent / currency
  precision?: number;
  symbol?: string;
  // rating / checkbox
  max?: number;
  icon?: string;
  color?: string;
  // duration
  durationFormat?: string;
  // date / dateTime
  dateFormat?: { name?: string; format?: string };
  timeFormat?: { name?: string; format?: string };
  timeZone?: string;
  // select-like
  choices?: IAirtableSelectChoice[];
  // multipleRecordLinks
  linkedTableId?: string;
  prefersSingleRecordLink?: boolean;
  inverseLinkFieldId?: string;
  isReversed?: boolean;
  /** "Limit record selection to a view" — the linked table's view id, when set. */
  viewIdForRecordSelection?: string;
  // lookup / rollup / count
  recordLinkFieldId?: string | null;
  fieldIdInLinkedTable?: string | null;
  isValid?: boolean;
  result?: IAirtableFieldResult | null;
  // formula
  formula?: string;
  referencedFieldIds?: string[] | null;
  // aiText: array of text chunks and field reference objects
  prompt?: unknown[];
}

export interface IAirtableField {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: IAirtableFieldOptions;
}

export interface IAirtableView {
  id: string;
  name: string;
  type: string;
}

export interface IAirtableTable {
  id: string;
  name: string;
  description?: string;
  primaryFieldId: string;
  fields: IAirtableField[];
  views: IAirtableView[];
}

export interface IAirtableBaseSchemaResponse {
  tables: IAirtableTable[];
}

export interface IAirtableAttachment {
  id: string;
  url: string;
  filename: string;
  size?: number;
  type?: string;
}

export interface IAirtableCollaborator {
  id: string;
  email?: string;
  name?: string;
}

export interface IAirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface IAirtableListRecordsResponse {
  records: IAirtableRecord[];
  offset?: string;
}

export interface IAirtableApiError {
  status: number;
  type?: string;
  message?: string;
}
