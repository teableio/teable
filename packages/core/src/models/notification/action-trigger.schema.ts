import { z } from 'zod';

/**
 * Presence signal emitted when a table's derived compute activity changes.
 * The payload is a refetch hint; authoritative values come from
 * `GET /v2/tables/getComputeActivity`.
 */
export const COMPUTE_ACTIVITY_CHANGED = 'computeActivityChanged';

export const tableActionKeys = z.enum([
  'addRecord',
  'setRecord',
  'deleteRecord',
  'addField',
  'setField',
  'deleteField',
  'taskProcessing',
  'taskCompleted',
  'taskCancelled',
  'taskFailed',
  COMPUTE_ACTIVITY_CHANGED,
]);

export const viewActionKeys = z.enum([
  'applyViewFilter',
  'applyViewGroup',
  'applyViewStatisticFunc',
  'showViewField',
]);

export const actionTriggerBufferSchema = tableActionKeys;

export type ITableActionKey = z.infer<typeof actionTriggerBufferSchema>;

export type IViewActionKey = z.infer<typeof viewActionKeys>;
