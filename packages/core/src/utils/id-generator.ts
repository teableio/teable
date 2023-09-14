import { customAlphabet } from 'nanoid';

export enum IdPrefix {
  Table = 'tbl',
  Field = 'fld',
  View = 'viw',
  Node = 'nod',
  Record = 'rec',
  Attachment = 'act',
  Choice = 'cho',

  Workflow = 'wfl',
  WorkflowTrigger = 'wtr',
  WorkflowAction = 'wac',
  WorkflowDecision = 'wde',

  User = 'usr',
}

export function getRandomString(len: number) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nanoid = customAlphabet(chars, len);
  return nanoid();
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
  return IdPrefix.Record + getRandomString(16);
}

export function generateChoiceId() {
  return IdPrefix.Choice + getRandomString(8);
}

export function generateTransactionKey() {
  return getRandomString(20);
}

export function generateAttachmentId() {
  return IdPrefix.Attachment + getRandomString(16);
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

export function generateWorkflowDecisionId() {
  return IdPrefix.WorkflowDecision + getRandomString(16);
}

export function generateUserId() {
  return IdPrefix.User + getRandomString(10);
}

export function identify(id: string): IdPrefix | undefined {
  if (id.length < 2) {
    return undefined;
  }

  const idPrefix = id.substring(0, 3);
  return (Object.values(IdPrefix) as string[]).includes(idPrefix)
    ? (idPrefix as IdPrefix)
    : undefined;
}
