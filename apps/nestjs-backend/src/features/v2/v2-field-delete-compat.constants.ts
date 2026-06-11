import type { IOtOperation } from '@teable/core';
import type { ILegacyDeleteFieldsPayloadSnapshot } from '../field/open-api/field-open-api.service';

export const V2_FIELD_DELETE_COMPAT_CONTEXT_KEY = '__teable_v2_field_delete_compat_context';

export interface IV2FieldDeleteCompatContext {
  tableId: string;
  userId: string;
  operationId: string;
  remainingFieldIds: Set<string>;
  frozenFieldOps: Record<string, IOtOperation[]>;
  legacyDeletePayload: ILegacyDeleteFieldsPayloadSnapshot;
  completed?: boolean;
}
