/**
 * DTO types for record events.
 * These are plain data structures used for event payloads.
 */

/** Single field value */
export type RecordFieldValueDTO = {
  fieldId: string;
  value: unknown;
};

/** Record with field values (for create events) */
export type RecordValuesDTO = {
  recordId: string;
  fields: ReadonlyArray<RecordFieldValueDTO>;
  /** View order values: viewId -> order number. Used for undo/redo. */
  orders?: Record<string, number>;
};

/** Source of record creation */
export type RecordCreateSource = { type: 'user' } | { type: 'form'; formId: string };

/** Field change with old and new value (for update events) */
export type RecordFieldChangeDTO = {
  fieldId: string;
  oldValue: unknown;
  newValue: unknown;
};

/** Record update with version info (for update events) */
export type RecordUpdateDTO = {
  recordId: string;
  oldVersion: number;
  newVersion: number;
  changes: ReadonlyArray<RecordFieldChangeDTO>;
};

/** Source of record update */
export type RecordUpdateSource = 'user' | 'computed';
