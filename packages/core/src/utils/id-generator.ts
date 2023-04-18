export enum IdPrefix {
  Table = 'tbl',
  Field = 'fld',
  View = 'viw',
  Node = 'nod',
  Record = 'rec',

  Workflow = 'wfl',
  WorkflowTrigger = 'wtr',
  WorkflowAction = 'wac',
}

export function getRandomString(len: number) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = len; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

export function generateTableId() {
  return IdPrefix.Table + getRandomString(16);
}

export function generateFieldId() {
  return IdPrefix.Field + getRandomString(16);
}

export function generateViewId() {
  return IdPrefix.View + getRandomString(16);
}

export function generateRecordId() {
  return IdPrefix.Record + getRandomString(8);
}

export function generateTransactionKey() {
  return getRandomString(20);
}

export function generateWorkflowId() {
  return IdPrefix.Workflow + getRandomString(16);
}

export function generateWorkflowTriggerId() {
  return IdPrefix.WorkflowTrigger + getRandomString(16);
}

export function generateWorkflowActionId() {
  return IdPrefix.WorkflowAction + getRandomString(16);
}
