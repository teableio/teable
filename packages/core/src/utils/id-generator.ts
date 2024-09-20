import { customAlphabet } from 'nanoid';

export enum IdPrefix {
  Space = 'spc',
  Base = 'bse',

  Table = 'tbl',
  Field = 'fld',
  View = 'viw',
  Record = 'rec',
  Comment = 'com',
  Attachment = 'act',
  Choice = 'cho',

  Workflow = 'wfl',
  WorkflowTrigger = 'wtr',
  WorkflowAction = 'wac',
  WorkflowDecision = 'wde',

  User = 'usr',
  Account = 'aco',

  Invitation = 'inv',

  Share = 'shr',

  Notification = 'not',

  AccessToken = 'acc',

  AuthorityMatrix = 'aut',
  AuthorityMatrixRole = 'aur',

  License = 'lic',

  OAuthClient = 'clt',

  Window = 'win',

  RecordHistory = 'rhi',

  Plugin = 'plg',
  PluginInstall = 'pli',
  PluginUser = 'plu',

  Dashboard = 'dsh',
}

const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nanoid = customAlphabet(chars);

export function getRandomString(len: number) {
  return nanoid(len);
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

export function generateCommentId() {
  return IdPrefix.Comment + getRandomString(16);
}

export function generateChoiceId() {
  return IdPrefix.Choice + getRandomString(8);
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
  return IdPrefix.User + getRandomString(16);
}

export function generateWindowId() {
  return IdPrefix.Window + getRandomString(16);
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

export function generateSpaceId() {
  return IdPrefix.Space + getRandomString(16);
}

export function generateBaseId() {
  return IdPrefix.Base + getRandomString(16);
}

export function generateInvitationId() {
  return IdPrefix.Invitation + getRandomString(16);
}

export function generateShareId() {
  return IdPrefix.Share + getRandomString(16);
}

export function generateNotificationId() {
  return IdPrefix.Notification + getRandomString(16);
}

export function generateAccessTokenId() {
  return IdPrefix.AccessToken + getRandomString(16);
}

export function generateAccountId() {
  return IdPrefix.Account + getRandomString(16);
}

export function generateAuthorityMatrixId() {
  return IdPrefix.AuthorityMatrix + getRandomString(16);
}

export function generateAuthorityMatrixRoleId() {
  return IdPrefix.AuthorityMatrixRole + getRandomString(16);
}

export function generateLicenseId() {
  return IdPrefix.License + getRandomString(16);
}

export function generateClientId() {
  return IdPrefix.OAuthClient + getRandomString(16).toLocaleLowerCase();
}

export function generateRecordHistoryId() {
  return IdPrefix.RecordHistory + getRandomString(24);
}

export function generatePluginId() {
  return IdPrefix.Plugin + getRandomString(16);
}

export function generatePluginInstallId() {
  return IdPrefix.PluginInstall + getRandomString(16);
}

export function generatePluginUserId() {
  return IdPrefix.PluginUser + getRandomString(16);
}

export function generateDashboardId() {
  return IdPrefix.Dashboard + getRandomString(12);
}
