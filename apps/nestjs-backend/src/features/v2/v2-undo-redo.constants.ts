import type { IFieldVo } from '@teable/core';

export const V2_FIELD_CONVERT_UNDO_CONTEXT_KEY = '__teable_v2_field_convert_undo_context';

export interface IV2FieldConvertUndoContext {
  tableId: string;
  fieldId: string;
  oldField: IFieldVo;
}
