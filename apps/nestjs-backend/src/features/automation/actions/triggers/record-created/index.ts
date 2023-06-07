import type { IConstSchema } from '../../action-core';

export interface ITriggerRecordCreatedSchema extends Record<string, unknown> {
  tableId: IConstSchema;
}

export interface ITriggerRecordCreatedOptions {
  tableId: string;
}

// const evalTrigger = async (): Promise<boolean> => {
//
//
//
//
//   return false;
// };
