import type { IFieldVo } from '@teable/core';

export const V2_FIELD_UPDATE_AUDIT_CONTEXT_KEY = '__teable_v2_field_update_audit_context';

export interface IV2FieldUpdateAuditContext {
  tableId: string;
  fieldId: string;
  oldField: IFieldVo;
  inputField: Record<string, unknown>;
}
