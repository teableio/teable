import type { IExecutionContext } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

export const V2_IMPORT_WORKFLOW_POLICY = Symbol('V2_IMPORT_WORKFLOW_POLICY');

export interface IV2ImportWorkflowPolicy {
  around<T>(
    input: {
      baseId: string;
      tableId?: string;
      container: DependencyContainer;
      context: IExecutionContext;
    },
    run: (options: { maxRowCount?: number; projection?: string[] }) => Promise<T>
  ): Promise<T>;
}
