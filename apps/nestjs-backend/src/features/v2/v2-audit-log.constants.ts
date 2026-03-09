import type { IFieldVo } from '@teable/core';

export const V2_FIELD_UPDATE_AUDIT_CONTEXT_KEY = '__teable_v2_field_update_audit_context';
export const V2_RECORD_PASTE_AUDIT_CONTEXT_KEY = '__teable_v2_record_paste_audit_context';

export interface IV2FieldUpdateAuditContext {
  tableId: string;
  fieldId: string;
  oldField: IFieldVo;
  inputField: Record<string, unknown>;
}
