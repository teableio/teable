import type { IExecutionContext } from '@teable/v2-core';
import type { ProcedurePath, ProcedurePolicy } from '@teable/v2-contract-http';
import type { DependencyContainer } from '@teable/v2-di';
import type { IClsStore } from '../../types/cls';

export const V2_PUBLIC_PROCEDURE_HOOK = Symbol('V2_PUBLIC_PROCEDURE_HOOK');

export interface IV2PublicProcedureInvocation {
  readonly path: ProcedurePath;
  readonly policy: ProcedurePolicy;
  readonly input: Record<string, unknown>;
  readonly resourceId?: string;
  /** Data ownership resolved by the host after credential/resource authorization. */
  readonly spaceId?: string;
  readonly container: DependencyContainer;
  readonly context: IExecutionContext;
  /** Trusted request state supplied by the authenticated Nest host, never caller input. */
  readonly cls: IClsStore;
}

export interface IV2PublicProcedureHook {
  around?<T>(invocation: IV2PublicProcedureInvocation, next: () => Promise<T>): Promise<T>;
  before(invocation: IV2PublicProcedureInvocation): Promise<void>;
  after(invocation: IV2PublicProcedureInvocation, output: unknown): Promise<unknown>;
}
