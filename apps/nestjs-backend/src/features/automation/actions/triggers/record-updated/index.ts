import type { IConstSchema, IObjectArraySchema } from '../../action-core';

export interface ITriggerRecordUpdatedSchema extends Record<string, unknown> {
  tableId: IConstSchema;
  viewId?: IConstSchema;
  watchFields: IObjectArraySchema;
}

export interface ITriggerRecordUpdated {
  tableId: string;
  viewId?: string | null;
  watchFields: string[];
}
