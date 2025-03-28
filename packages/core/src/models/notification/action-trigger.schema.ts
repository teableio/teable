import { z } from 'zod';

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
