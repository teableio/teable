import type { IExecutionContext } from '@teable/v2-core';

export const V2_SHARE_WRITE_ADMISSION = Symbol('V2_SHARE_WRITE_ADMISSION');

/** Share identity and target ownership resolved by the host after share authorization. */
export interface IV2ShareWriteInvocation {
  readonly shareId: string;
  readonly tableId: string;
  readonly baseId: string;
  readonly context: IExecutionContext;
}

/** Edition host boundary for writes that can create rows, including nested link-title creates. */
export interface IV2ShareWriteAdmission {
  around<T>(invocation: IV2ShareWriteInvocation, next: () => Promise<T>): Promise<T>;
}
